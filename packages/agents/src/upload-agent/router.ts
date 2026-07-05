/**
 * Agent loop / message router.
 *
 * State machine:
 *   IDLE          → first user message → GREETING_BACK (LLM reply)
 *   GREETING_BACK → user uploads audio → ANALYZING (LLM caption + decide)
 *   ANALYZING     → user uploads cover → DECISION_READY
 *   DECISION_READY → user confirms or edits → COMMITTED (or stays)
 *
 * The router is stateless — given a session row + new user message, it
 * computes the next messages[] array and persists it. The HTTP route
 * stores the result and returns.
 *
 * The router never throws — all errors become "fallback" responses.
 */

import type { PrismaClient } from '@prisma/client';
import { analyzeAudio } from './analyze';
import { captionCover, decideMetadata } from './decide';
import { llmHealth, chatText } from './llm';

export type AgentMessageRole = 'user' | 'assistant' | 'system' | 'tool';
export type AgentMessageKind =
  | 'greeting'
  | 'chat'
  | 'audio_analyzed'
  | 'cover_analyzed'
  | 'decision_proposed'
  | 'recipient_resolved'
  | 'recipient_unresolved'
  | 'commit_preview'
  | 'commit_done'
  | 'fallback_notice'
  | 'error';

export type AgentMessage = {
  id: string;
  role: AgentMessageRole;
  kind: AgentMessageKind;
  text: string;
  payload?: Record<string, unknown>;
  createdAt: string;
};

export type AgentSessionState = {
  id: string;
  userId: string;
  state: 'idle' | 'awaiting_audio' | 'awaiting_cover' | 'awaiting_decision' | 'committing' | 'committed' | 'error';
  draft: {
    title?: string;
    description?: string;
    moodTags?: string[];
    audioQuality?: 'low' | 'mid' | 'high';
    confidence?: 'low' | 'mid' | 'high';
    reasoning?: string;
    streamRateUsdc?: number;
    recipients?: Array<{
      username: string;
      role: 'primary_artist' | 'featured_artist' | 'producer' | 'songwriter' | 'label' | 'custom';
      percentageBps: number;
      type: 'internal' | 'external';
      externalWalletAddress?: string;
      externalLabel?: string;
      resolvedUserId?: string;
      resolution?: 'ok' | 'not_found' | 'external';
    }>;
    audioFileName?: string;
    audioStorageKey?: string;
    coverFileName?: string;
    coverStorageKey?: string;
    audioAnalysis?: Record<string, unknown>;
    coverCaption?: string;
    llmHealth?: { ok: boolean; provider: string; model: string; reason?: string };
  };
  llm: {
    provider: string;
    model: string;
    ok: boolean;
    reason?: string;
  };
  createdAt: string;
  updatedAt: string;
  messages?: Array<{ role: 'user' | 'assistant'; text: string }>;
};

const AGENT_SYSTEM_PROMPT = `You are Pazzera's Upload Agent — an upbeat, friendly,
music-savvy AI assistant. You help independent artists publish tracks on
Pazzera, a pay-per-listen platform where listeners pay USDC per stream via
Circle x402 + Gateway.

Your conversational style:
- Concise, warm, Gen-Z tone. Use "you", "we", short sentences.
- Don't lecture about crypto or blockchain — artists care about getting paid.
- Never say "as an AI" or "I cannot".
- When you have a question, ask ONE question at a time.
- When the user confirms a decision, say "Great" or "Sounds good" — keep momentum.

First message: greet the artist by name (if known) and ask them to drop their audio file.`;

/**
 * Build the system prompt for free-form chat replies. Adds current upload
 * context to the base persona so the agent can answer intelligently about
 * the user's in-progress upload.
 */
function buildChatSystemPrompt(args: {
  session: AgentSessionState;
  artistPrimary: { username: string; userId: string };
}): string {
  const ctxLines: string[] = [
    `Artist in focus: @${args.artistPrimary.username}.`,
    `Current upload state: ${args.session.state}.`,
  ];
  if (args.session.draft && Object.keys(args.session.draft).length > 0) {
    ctxLines.push(`Draft so far: ${summarizeDraft(args.session.draft)}`);
  }
  return `${AGENT_SYSTEM_PROMPT}\n\n${ctxLines.join('\n')}\n\nYou can answer questions about music, uploading, Pazzera mechanics, royalty splits, the curator process, and the underlying payment rails (x402, Circle Gateway, USDC on Arc). Keep replies to 2–4 sentences unless the user asks for detail. If the user asks for an upload action (e.g. change title, set rate), interpret the request and gently nudge them toward the next file to drop or the decision card.`;
}

/**
 * Compress the draft into a single-line summary for the LLM context.
 */
function summarizeDraft(draft: AgentSessionState['draft']): string {
  if (!draft) return 'none yet';
  const parts: string[] = [];
  if (draft.title) parts.push(`title="${draft.title}"`);
  if (draft.description) parts.push(`description set`);
  if (typeof draft.streamRateUsdc === 'number') parts.push(`rate=${draft.streamRateUsdc} USDC/stream`);
  if (draft.recipients && draft.recipients.length > 0) {
    parts.push(`${draft.recipients.length} recipients`);
  }
  if (draft.audioStorageKey) parts.push(`audio uploaded`);
  if (draft.coverStorageKey) parts.push(`cover uploaded`);
  return parts.length > 0 ? parts.join(', ') : 'empty';
}

/**
 * Append a message to a session's messages[] JSON column.
 */
export async function appendMessage(
  prisma: PrismaClient,
  sessionId: string,
  msg: Omit<AgentMessage, 'id' | 'createdAt'>,
): Promise<AgentMessage> {
  const full: AgentMessage = {
    ...msg,
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  await prisma.$executeRaw`
    UPDATE "AgentUploadSession"
    SET "messages" = COALESCE("messages", '[]'::jsonb) || ${JSON.stringify([full])}::jsonb,
        "updatedAt" = NOW()
    WHERE "id" = ${sessionId}
  `;
  return full;
}

/**
 * Update the session's `state` JSON (kept as a separate column) and the
 * optional `draft` sub-object inside it.
 */
export async function updateSessionState(
  prisma: PrismaClient,
  sessionId: string,
  state: AgentSessionState['state'],
  draftPatch?: Record<string, unknown>,
): Promise<void> {
  const session = await prisma.agentUploadSession.findUnique({ where: { id: sessionId } });
  if (!session) return;
  const current = (session.state ?? {}) as AgentSessionState;
  const merged: AgentSessionState = {
    ...current,
    state,
    draft: { ...current.draft, ...(draftPatch ?? {}) },
    updatedAt: new Date().toISOString(),
  };
  await prisma.agentUploadSession.update({
    where: { id: sessionId },
    data: { state: merged as any },
  });
}

export type HandleInput =
  | { kind: 'text'; text: string }
  | { kind: 'audio'; storageKey: string; fileName: string }
  | { kind: 'cover'; storageKey: string; fileName: string; coverUrl: string }
  | { kind: 'recipient_username'; index: number; username: string }
  | { kind: 'recipient_pct'; index: number; percentageBps: number }
  | { kind: 'rate'; streamRateUsdc: number }
  | { kind: 'commit'; recipients: AgentSessionState['draft']['recipients'] }
  | { kind: 'reset' };

/**
 * Main entry: process one user input and return the new messages.
 * Does NOT persist anything itself — caller does that.
 */
export async function handleInput(args: {
  prisma: PrismaClient;
  session: AgentSessionState;
  input: HandleInput;
  getFilePath: (storageKey: string) => Promise<string>;
  artistPrimary: { username: string; userId: string };
}): Promise<{ nextState: AgentSessionState; assistantMessages: AgentMessage[] }> {
  const messages: AgentMessage[] = [];
  const next: AgentSessionState = JSON.parse(JSON.stringify(args.session));

  switch (args.input.kind) {
    case 'text': {
      const text = args.input.text.trim();
      if (!text) {
        messages.push({
          id: '',
          role: 'assistant',
          kind: 'chat',
          text: 'Say something — even just "hi" works.',
          createdAt: '',
        });
        break;
      }
      // Already-committed session — user is reacting post-publish.
      // Don't try to interpret as edits; just acknowledge warmly and
      // offer to start a fresh upload.
      if (next.state === 'committed' || next.state === 'committing') {
        const title = (next.draft?.title as string | undefined) ?? 'your track';
        messages.push({
          id: '',
          role: 'assistant',
          kind: 'chat',
          text: `"${title}" has been submitted to the curator 🎶 Audio, cover, splits, rate — all locked in. Tap "Reset" when you want to upload a new track.`,
          createdAt: '',
        });
        break;
      }
      // Free-text — interpret as a question or edit request
      const lower = text.toLowerCase();
      const looksLikeTitle = text.length < 60 && !text.includes(' ');
      const looksLikeRate = /\$?\s*0\.00\d/.test(text);
      if (looksLikeTitle && next.state === 'awaiting_decision') {
        next.draft.title = text;
        messages.push({
          id: '',
          role: 'assistant',
          kind: 'chat',
          text: `Got it — title updated to "${text}". Anything else to tweak?`,
          createdAt: '',
        });
      } else if (looksLikeRate) {
        const m = text.match(/0\.00\d/);
        if (m) {
          const rate = Number(m[0]);
          if (rate >= 0.001 && rate <= 0.005) {
            next.draft.streamRateUsdc = rate;
            messages.push({
              id: '',
              role: 'assistant',
              kind: 'chat',
              text: `Rate updated to ${rate.toFixed(3)} USDC per stream.`,
              createdAt: '',
            });
          }
        }
      } else if (/(yes|sure|ok|okay|do it|ship it|publish)/.test(lower) && next.state === 'awaiting_decision') {
        messages.push({
          id: '',
          role: 'assistant',
          kind: 'commit_preview',
          text: 'Awesome. Hit the "Upload" button below to publish. I\'ve pre-filled everything based on your audio + cover.',
          createdAt: '',
        });
      } else if (/(reset|start over|cancel)/.test(lower)) {
        next.state = 'idle';
        next.draft = {};
        messages.push({
          id: '',
          role: 'assistant',
          kind: 'chat',
          text: 'Fresh start. What\'s the track called?',
          createdAt: '',
        });
      } else {
        // Free-form chat — route through the LLM so the agent behaves
        // like a real AI chatbot, not a templated form. Falls back to a
        // warm prompt-styled message if the LLM is unavailable.
        const sys = buildChatSystemPrompt(args);
        const history = (args.session.messages ?? []).slice(-12).map((m) => ({
          role: m.role === 'user' ? 'user' as const : 'assistant' as const,
          content: m.text ?? '',
        }));
        const ctx = `Current upload state: ${next.state}. Draft: ${summarizeDraft(next.draft)}`;
        const llmRes = await chatText({ system: sys + '\n\n' + ctx, history, user: text });
        messages.push({
          id: '',
          role: 'assistant',
          kind: 'chat',
          text: llmRes.ok
            ? (llmRes.data ?? '').trim() || 'Hmm, my response came back empty. Try asking again?'
            : `I'm having trouble reaching my brain right now — but I heard you. Drop your audio file when ready, or hit Reset to start over.`,
          createdAt: '',
        });
      }
      break;
    }

    case 'audio': {
      next.draft.audioFileName = args.input.fileName;
      next.draft.audioStorageKey = args.input.storageKey;
      const path = await args.getFilePath(args.input.storageKey);
      const analysis = await analyzeAudio({ filePath: path, originalFilename: args.input.fileName });
      next.draft.audioAnalysis = analysis as unknown as Record<string, unknown>;

      // Skip caption for now — we'll do it when the cover arrives
      messages.push({
        id: '',
        role: 'assistant',
        kind: 'audio_analyzed',
        text: `Got "${args.input.fileName}" — ${analysis.format} · ${analysis.durationSeconds || '?'}s · ${analysis.bitrateKbps ?? '?'} kbps · ${analysis.energy} energy. Drop your cover art next.`,
        payload: { analysis },
        createdAt: '',
      });
      next.state = 'awaiting_cover';
      break;
    }

    case 'cover': {
      next.draft.coverFileName = args.input.fileName;
      next.draft.coverStorageKey = args.input.storageKey;
      next.draft.coverCaption = undefined;

      // Caption via vision + decide
      const { caption } = await captionCover(args.input.coverUrl);
      if (caption) next.draft.coverCaption = caption;

      // Build decision
      const audioAnalysis = (next.draft.audioAnalysis ?? {}) as unknown as Parameters<typeof decideMetadata>[0]['analysis'];
      const { decision } = await decideMetadata({
        analysis: audioAnalysis as any,
        coverCaption: caption ?? undefined,
        artistHint: { username: args.artistPrimary.username },
      });

      next.draft.title = decision.title;
      next.draft.description = decision.description;
      next.draft.moodTags = decision.moodTags;
      next.draft.audioQuality = decision.audioQuality;
      next.draft.confidence = decision.confidence;
      next.draft.reasoning = decision.reasoning;
      next.draft.streamRateUsdc = decision.streamRateUsdc;

      // Seed default recipients
      next.draft.recipients = [
        {
          username: args.artistPrimary.username,
          role: 'primary_artist',
          percentageBps: 7000,
          type: 'internal',
          resolvedUserId: args.artistPrimary.userId,
          resolution: 'ok',
        },
        {
          username: '',
          role: 'featured_artist',
          percentageBps: 2000,
          type: 'internal',
        },
        {
          username: '',
          role: 'producer',
          percentageBps: 1000,
          type: 'internal',
        },
      ];

      messages.push({
        id: '',
        role: 'assistant',
        kind: 'cover_analyzed',
        text: `Cover analyzed. Now proposing metadata based on your audio + cover:`,
        payload: { caption },
        createdAt: '',
      });
      messages.push({
        id: '',
        role: 'assistant',
        kind: 'decision_proposed',
        text: '',
        payload: { decision },
        createdAt: '',
      });
      messages.push({
        id: '',
        role: 'assistant',
        kind: 'chat',
        text: 'Featured artist? Drop their Pazzera username (or leave blank). You can also tweak the rate, title, or splits.',
        createdAt: '',
      });

      next.state = 'awaiting_decision';
      break;
    }

    case 'recipient_username': {
      const recipients = next.draft.recipients ?? [];
      const r = recipients[args.input.index];
      if (!r) break;
      r.username = args.input.username;
      if (!args.input.username.trim()) {
        r.resolution = undefined;
        r.resolvedUserId = undefined;
        messages.push({
          id: '',
          role: 'assistant',
          kind: 'chat',
          text: 'Cleared.',
          createdAt: '',
        });
        break;
      }
      // Look up via Prisma
      const cleanUsername = args.input.username.trim().replace(/^@/, '').toLowerCase();
      const user = await args.prisma.user.findFirst({
        where: {
          username: cleanUsername,
        },
        select: { id: true, username: true },
      });
      if (user) {
        r.resolvedUserId = user.id;
        r.resolution = 'ok';
        r.type = 'internal';
        messages.push({
          id: '',
          role: 'assistant',
          kind: 'recipient_resolved',
          text: `Found @${user.username}.`,
          payload: { index: args.input.index, username: user.username, userId: user.id },
          createdAt: '',
        });
      } else {
        // Try to suggest similar usernames. We accept prefixes of length
        // >= 2 and suggest up to 3 closest matches so the user can
        // type the full handle instead of giving up.
        let suggestions: string[] = [];
        if (cleanUsername.length >= 2) {
          const prefixMatches = await args.prisma.user.findMany({
            where: {
              username: { startsWith: cleanUsername },
            },
            select: { username: true },
            take: 3,
            orderBy: { username: 'asc' },
          });
          suggestions = prefixMatches.map((u) => u.username);
        }
        r.resolution = 'not_found';
        r.resolvedUserId = undefined;
        r.type = 'internal';
        const suggestText =
          suggestions.length > 0
            ? `Couldn't find "@${cleanUsername}" on Pazzera. Did you mean @${suggestions[0]}${suggestions.length > 1 ? ` (or @${suggestions.slice(1).join(', @')})` : ''}?`
            : `Couldn't find "@${cleanUsername}" on Pazzera. They need to sign up first, or you can split to an external wallet.`;
        messages.push({
          id: '',
          role: 'assistant',
          kind: 'recipient_unresolved',
          text: suggestText,
          payload: { index: args.input.index, username: cleanUsername, suggestions },
          createdAt: '',
        });
      }
      break;
    }

    case 'recipient_pct': {
      const recipients = next.draft.recipients ?? [];
      const r = recipients[args.input.index];
      if (!r) break;
      r.percentageBps = Math.max(0, Math.min(10000, args.input.percentageBps));
      messages.push({
        id: '',
        role: 'assistant',
        kind: 'chat',
        text: `Updated ${r.role} to ${(r.percentageBps / 100).toFixed(0)}%.`,
        createdAt: '',
      });
      break;
    }

    case 'rate': {
      const rate = Math.max(0.001, Math.min(0.005, args.input.streamRateUsdc));
      next.draft.streamRateUsdc = Math.round(rate * 1000) / 1000;
      messages.push({
        id: '',
        role: 'assistant',
        kind: 'chat',
        text: `Rate set to ${next.draft.streamRateUsdc.toFixed(3)} USDC per stream.`,
        createdAt: '',
      });
      break;
    }

    case 'commit': {
      messages.push({
        id: '',
        role: 'assistant',
        kind: 'commit_preview',
        text: 'On it — starting the upload pipeline.',
        payload: { recipients: args.input.recipients },
        createdAt: '',
      });
      next.state = 'committed';
      break;
    }

    case 'reset': {
      next.state = 'idle';
      next.draft = {};
      messages.push({
        id: '',
        role: 'assistant',
        kind: 'chat',
        text: 'Reset. What\'s the new track?',
        createdAt: '',
      });
      break;
    }
  }

  // Decorate each message with id/createdAt + filter empties
  const stamped = messages.filter((m) => m.text || m.payload).map((m, i) => ({
    ...m,
    id: m.id || `msg_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: m.createdAt || new Date().toISOString(),
  }));

  return { nextState: next, assistantMessages: stamped };
}

/**
 * Initial greeting message — written when the session is first created.
 */
export function buildInitialGreeting(artistUsername?: string): AgentMessage {
  const name = artistUsername ? `@${artistUsername}` : 'there';
  return {
    id: `msg_init_${Date.now()}`,
    role: 'assistant',
    kind: 'greeting',
    text: `Hey ${name}! I'm your upload agent. Drop your audio file (mp3/wav/m4a/flac) and I'll analyze it for you. Then we'll add the cover, I'll suggest metadata + a fair per-stream rate, and you can publish.`,
    createdAt: new Date().toISOString(),
  };
}

export const __test = {
  AGENT_SYSTEM_PROMPT,
  llmHealth,
};