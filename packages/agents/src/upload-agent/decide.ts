/**
 * Decision layer.
 *
 * Given an audio analysis + optional cover-art caption, asks the LLM to
 * propose:
 *   - title (string)
 *   - description (1-2 sentences, artist-voiced)
 *   - moodTags (array of 2-4 short strings)
 *   - audioQuality ('low' | 'mid' | 'high') — from LLM's perspective
 *   - confidence ('low' | 'mid' | 'high')
 *   - reasoning (1-2 sentences explaining the score)
 *   - streamRateUsdc — MUST be in [0.001, 0.005]
 *
 * Hard rules:
 *   - NEVER reject. Worst case: 0.001 USDC.
 *   - ALWAYS clamp to bounds.
 *   - The LLM is told to bias toward 'high' for clean, high-energy tracks
 *     and 'low' for ambient / lo-fi.
 */

import { chat, chatVision, LlmResult } from './llm';
import type { AudioAnalysis } from './analyze';

export type AgentDecision = {
  title: string;
  description: string;
  moodTags: string[];
  audioQuality: 'low' | 'mid' | 'high';
  confidence: 'low' | 'mid' | 'high';
  reasoning: string;
  streamRateUsdc: number;
};

const SYSTEM_PROMPT = `You are Pazzera's Upload Agent — an upbeat, friendly, music-savvy assistant
helping independent artists publish their songs on Pazzera, a pay-per-listen
music platform where listeners pay USDC per second via Circle x402 + Gateway.

Your job: read the artist's audio features + cover art and propose
metadata + a stream rate.

CRITICAL RULES:
1. You NEVER reject an upload. Worst case: streamRateUsdc = 0.001.
2. Pick a stream rate between 0.001 and 0.005 USDC. Round to 3 decimals.
3. Bias toward the HIGH end (0.004-0.005) for clean, high-energy,
   well-produced tracks. Bias toward the LOW end (0.001-0.002) for
   ambient, lo-fi, or unmastered demos.
4. The title should be a clean short title (≤40 chars). Don't include
   artist name in the title — recipients[0] is the artist.
5. Mood tags: 2-4 lowercase words. Examples: "chill", "dark", "energetic".
6. Description: 1-2 sentences in the artist's voice — friendly,
   first-person plural ("we", "this track"). Never mention "Pazzera".
7. Reasoning: 1 sentence explaining the rate you picked. Reference the
   audio features concretely (e.g. "140 BPM house with high bitrate").
8. Output STRICT JSON. No commentary. No markdown fences.

Schema reminder:
{
  "title": "string",
  "description": "string",
  "moodTags": ["string", ...],
  "audioQuality": "low" | "mid" | "high",
  "confidence": "low" | "mid" | "high",
  "reasoning": "string",
  "streamRateUsdc": number
}`;

const MIN_RATE = Number(process.env.CURATOR_PRICE_MIN_USDC ?? '0.001');
const MAX_RATE = Number(process.env.CURATOR_PRICE_MAX_USDC ?? '0.005');

function clamp(n: number): number {
  if (!Number.isFinite(n)) return MIN_RATE;
  if (n < MIN_RATE) return MIN_RATE;
  if (n > MAX_RATE) return MAX_RATE;
  return Math.round(n * 1000) / 1000;
}

function fallback(analysis: AudioAnalysis, reason: string): AgentDecision {
  // Deterministic default when LLM is unavailable
  const rateFromEnergy = analysis.energy === 'high' ? 0.004 : analysis.energy === 'mid' ? 0.003 : 0.002;
  return {
    title: analysis.tags.title ?? 'Untitled track',
    description: analysis.tags.comment ?? 'A new track, ready to play.',
    moodTags: analysis.moodFromTag ? [analysis.moodFromTag] : ['fresh'],
    audioQuality: analysis.confidence,
    confidence: 'low',
    reasoning: `LLM unavailable (${reason}); used deterministic defaults from audio features.`,
    streamRateUsdc: clamp(rateFromEnergy),
  };
}

export async function decideMetadata(args: {
  analysis: AudioAnalysis;
  coverCaption?: string;
  artistHint?: { username?: string; displayName?: string };
}): Promise<{ decision: AgentDecision; llm: LlmResult<AgentDecision> }> {
  const userContext = [
    `Audio analysis: ${JSON.stringify(args.analysis, null, 0)}`,
    args.coverCaption ? `Cover art caption: ${args.coverCaption}` : '',
    args.artistHint?.username ? `Artist username: @${args.artistHint.username}` : '',
    args.artistHint?.displayName ? `Artist display name: ${args.artistHint.displayName}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const schemaHint = `{
  "title": "string",
  "description": "string (1-2 sentences)",
  "moodTags": ["chill", "..."],
  "audioQuality": "low" | "mid" | "high",
  "confidence": "low" | "mid" | "high",
  "reasoning": "string",
  "streamRateUsdc": 0.003
}`;

  const result: LlmResult<AgentDecision> = await chat<AgentDecision>({
    system: SYSTEM_PROMPT,
    user: userContext,
    schemaHint,
    temperature: 0.5,
  });

  if (result.ok === false) {
    return { decision: fallback(args.analysis, (result as { ok: false; error: string }).error), llm: result };
  }

  // Sanitize the LLM response — never trust it blindly
  const data = result.data;
  const decision: AgentDecision = {
    title: typeof data.title === 'string' && data.title.length > 0 ? data.title.slice(0, 80) : args.analysis.tags.title ?? 'Untitled track',
    description: typeof data.description === 'string' ? data.description.slice(0, 280) : 'A new track, ready to play.',
    moodTags: Array.isArray(data.moodTags)
      ? data.moodTags.filter((m) => typeof m === 'string').map((m) => m.toLowerCase().slice(0, 24)).slice(0, 5)
      : args.analysis.moodFromTag ? [args.analysis.moodFromTag] : ['fresh'],
    audioQuality: data.audioQuality === 'high' || data.audioQuality === 'mid' || data.audioQuality === 'low' ? data.audioQuality : args.analysis.confidence,
    confidence: data.confidence === 'high' || data.confidence === 'mid' ? data.confidence : 'low',
    reasoning: typeof data.reasoning === 'string' ? data.reasoning.slice(0, 280) : 'Proposed by the AI agent based on the audio features.',
    streamRateUsdc: clamp(Number(data.streamRateUsdc)),
  };

  return { decision, llm: result };
}

/**
 * Caption cover art via vision. Returns a 1-2 sentence description
 * suitable for feeding into decideMetadata.
 */
export async function captionCover(imageUrl: string): Promise<{ caption: string | null; llm: LlmResult<{ caption: string }> }> {
  const result = await chatVision<{ caption: string }>({
    system: `You are a music-album art critic. Describe the cover art in 1-2 sentences.
Focus on mood, color palette, and any visible artist/title text.
Do NOT speculate about the artist's identity or message — just describe what you see.
Output JSON with a single "caption" string.`,
    userText: 'Describe this cover art in 1-2 sentences.',
    imageUrls: [imageUrl],
    schemaHint: '{ "caption": "string" }',
    temperature: 0.3,
    maxTokens: 200,
  });

  if (!result.ok) {
    return { caption: null, llm: result };
  }
  const caption = result.data.caption ?? '';
  return { caption: caption.slice(0, 400) || null, llm: result };
}