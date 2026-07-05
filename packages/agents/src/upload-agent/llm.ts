/**
 * LLM wrapper for the upload-agent.
 *
 * Reads the same env vars as the rest of Pazzera:
 *   LLM_PROVIDER  — 'openai' (default)
 *   LLM_API_KEY   — required when LLM_PROVIDER=openai
 *   LLM_BASE_URL  — defaults to https://api.openai.com/v1
 *   LLM_MODEL     — defaults to 'gpt-4o-mini'
 *
 * Exposes:
 *   - chat()       — non-streamed JSON completion with JSON mode
 *   - chatVision() — accepts image_url inputs
 *
 * The agent NEVER throws on LLM errors. Instead, callers must check
 * `result.ok` and fall back to deterministic defaults. The user's manual
 * upload form must always keep working.
 */

import OpenAI from 'openai';

type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ChatContentPart[] }
  | { role: 'assistant'; content: string };

type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export type LlmResult<T> =
  | { ok: true; data: T; model: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }
  | { ok: false; error: string; reason: 'missing_config' | 'network' | 'rate_limit' | 'invalid_json' | 'auth' | 'unknown' };

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    console.warn('[upload-agent/llm] LLM_API_KEY not set — agent will fall back to defaults');
    return null;
  }
  const baseURL = process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1';
  cachedClient = new OpenAI({ apiKey, baseURL });
  return cachedClient;
}

function getModel(): string {
  return process.env.LLM_MODEL ?? 'gpt-4o-mini';
}

/**
 * Single-shot chat completion that asks the model for JSON.
 * The model is asked to return a JSON object matching `schemaHint` (just a
 * shape reminder in the prompt — we don't enforce a strict JSON schema to
 * keep the wrapper provider-agnostic).
 */
export async function chat<T = unknown>(args: {
  system: string;
  user: string;
  schemaHint: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<LlmResult<T>> {
  const client = getClient();
  if (!client) {
    return { ok: false, error: 'LLM_API_KEY not configured', reason: 'missing_config' };
  }
  try {
    const completion = await client.chat.completions.create({
      model: getModel(),
      temperature: args.temperature ?? 0.4,
      max_tokens: args.maxTokens ?? 800,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: args.system },
        { role: 'user', content: `${args.user}\n\nRespond with JSON matching this shape:\n${args.schemaHint}` },
      ],
    });
    const text = completion.choices?.[0]?.message?.content ?? '';
    try {
      const data = JSON.parse(text) as T;
      return {
        ok: true,
        data,
        model: completion.model,
        usage: completion.usage
          ? {
              promptTokens: completion.usage.prompt_tokens,
              completionTokens: completion.usage.completion_tokens,
              totalTokens: completion.usage.total_tokens,
            }
          : undefined,
      };
    } catch {
      return { ok: false, error: `LLM returned non-JSON: ${text.slice(0, 200)}`, reason: 'invalid_json' };
    }
  } catch (err) {
    const e = err as { status?: number; message?: string };
    if (e?.status === 401 || e?.status === 403) {
      return { ok: false, error: e?.message ?? 'auth error', reason: 'auth' };
    }
    if (e?.status === 429) {
      return { ok: false, error: e?.message ?? 'rate limited', reason: 'rate_limit' };
    }
    return { ok: false, error: e?.message ?? String(err), reason: 'network' };
  }
}

/**
 * Free-form chat — no JSON mode, no schema. Used for casual
 * conversation where the model should just speak naturally.
 */
export async function chatText(args: {
  system: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  user: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<LlmResult<string>> {
  const client = getClient();
  if (!client) {
    return { ok: false, error: 'LLM_API_KEY not configured', reason: 'missing_config' };
  }
  try {
    const messages = [
      { role: 'system' as const, content: args.system },
      ...args.history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: args.user },
    ];
    const completion = await client.chat.completions.create({
      model: getModel(),
      temperature: args.temperature ?? 0.6,
      max_tokens: args.maxTokens ?? 400,
      messages,
    });
    const text = completion.choices?.[0]?.message?.content ?? '';
    return {
      ok: true,
      data: text,
      model: completion.model,
      usage: completion.usage
        ? {
            promptTokens: completion.usage.prompt_tokens,
            completionTokens: completion.usage.completion_tokens,
            totalTokens: completion.usage.total_tokens,
          }
        : undefined,
    };
  } catch (err) {
    const e = err as { status?: number; message?: string };
    if (e?.status === 401 || e?.status === 403) {
      return { ok: false, error: e?.message ?? 'auth error', reason: 'auth' };
    }
    if (e?.status === 429) {
      return { ok: false, error: e?.message ?? 'rate limited', reason: 'rate_limit' };
    }
    return { ok: false, error: e?.message ?? String(err), reason: 'network' };
  }
}

/**
 * Vision-capable chat. Pass image URLs (https://... or data:image/... base64).
 */
export async function chatVision<T = unknown>(args: {
  system: string;
  userText: string;
  imageUrls: string[];
  schemaHint: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<LlmResult<T>> {
  const client = getClient();
  if (!client) {
    return { ok: false, error: 'LLM_API_KEY not configured', reason: 'missing_config' };
  }
  // Use a vision-capable model if available; fall back to gpt-4o
  const visionModel = process.env.LLM_VISION_MODEL ?? 'gpt-4o';
  try {
    const parts: ChatContentPart[] = [{ type: 'text', text: `${args.userText}\n\nRespond with JSON matching this shape:\n${args.schemaHint}` }];
    for (const url of args.imageUrls) {
      parts.push({ type: 'image_url', image_url: { url, detail: 'low' } });
    }
    const completion = await client.chat.completions.create({
      model: visionModel,
      temperature: args.temperature ?? 0.4,
      max_tokens: args.maxTokens ?? 600,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: args.system },
        { role: 'user', content: parts },
      ],
    });
    const text = completion.choices?.[0]?.message?.content ?? '';
    try {
      const data = JSON.parse(text) as T;
      return {
        ok: true,
        data,
        model: completion.model,
        usage: completion.usage
          ? {
              promptTokens: completion.usage.prompt_tokens,
              completionTokens: completion.usage.completion_tokens,
              totalTokens: completion.usage.total_tokens,
            }
          : undefined,
      };
    } catch {
      return { ok: false, error: `Vision LLM returned non-JSON: ${text.slice(0, 200)}`, reason: 'invalid_json' };
    }
  } catch (err) {
    const e = err as { status?: number; message?: string };
    if (e?.status === 401 || e?.status === 403) {
      return { ok: false, error: e?.message ?? 'auth error', reason: 'auth' };
    }
    if (e?.status === 429) {
      return { ok: false, error: e?.message ?? 'rate limited', reason: 'rate_limit' };
    }
    return { ok: false, error: e?.message ?? String(err), reason: 'network' };
  }
}

/**
 * Health check — does the LLM env look usable?
 */
export function llmHealth(): { ok: boolean; provider: string; model: string; reason?: string } {
  const provider = process.env.LLM_PROVIDER ?? 'openai';
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    return { ok: false, provider, model: getModel(), reason: 'LLM_API_KEY not set' };
  }
  return { ok: true, provider, model: getModel() };
}

// Re-export OpenAI types if callers want them
export type { ChatMessage, ChatContentPart };