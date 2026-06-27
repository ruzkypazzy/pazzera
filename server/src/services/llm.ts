/**
 * OpenAI-compatible LLM client used by all Pazzera agents
 * (Curator Agent, Fan Agent, Royalty Splitter Agent reasoning).
 *
 * Reads config from env:
 *   LLM_API_KEY   — required at runtime, optional in tests (mocked)
 *   LLM_BASE_URL  — defaults to https://api.freemodel.dev/v1 (free OpenAI-compatible provider)
 *   LLM_MODEL     — defaults to gpt-4o-mini (auto-routes to a stronger model on FreeModel)
 *
 * Why OpenAI-compatible: any provider (OpenAI, Anthropic-via-proxy, OpenRouter,
 * MiniMax, FreeModel) exposes the same /v1/chat/completions shape. Switching is
 * one env var.
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
}

export interface LLMToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

export interface LLMResponse {
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string; // JSON string
  }>;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

const DEFAULT_BASE = 'https://api.freemodel.dev/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

function getConfig() {
  return {
    apiKey: process.env.LLM_API_KEY ?? '',
    baseUrl: process.env.LLM_BASE_URL ?? DEFAULT_BASE,
    model: process.env.LLM_MODEL ?? DEFAULT_MODEL,
  };
}

export { getConfig };

/**
 * Single chat completion call. If tools are provided, the model can return tool_calls.
 * Caller is responsible for feeding tool results back into the next call (ReAct loop).
 */
export async function llmChat(args: {
  messages: LLMMessage[];
  tools?: LLMToolDef[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<LLMResponse> {
  const { apiKey, baseUrl, model } = getConfig();

  if (!apiKey) {
    throw new Error(
      '[llm] LLM_API_KEY is not set. Add it to Railway Variables (or .env locally). ' +
      'See README for provider options.'
    );
  }

  const body: Record<string, unknown> = {
    model,
    messages: args.messages,
    temperature: args.temperature ?? 0.7,
    max_tokens: args.maxTokens ?? 1024,
  };
  if (args.tools && args.tools.length > 0) {
    body.tools = args.tools;
    body.tool_choice = 'auto';
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: args.signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[llm] ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
  }

  const json = (await res.json()) as any;
  const choice = json.choices?.[0];
  if (!choice) {
    throw new Error('[llm] no choices in response: ' + JSON.stringify(json).slice(0, 500));
  }

  const msg = choice.message ?? {};
  const toolCalls = (msg.tool_calls ?? []).map((tc: any) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: tc.function.arguments,
  }));

  return {
    content: msg.content ?? '',
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    finishReason: choice.finish_reason ?? 'stop',
    usage: json.usage
      ? {
          promptTokens: json.usage.prompt_tokens ?? 0,
          completionTokens: json.usage.completion_tokens ?? 0,
          totalTokens: json.usage.total_tokens ?? 0,
        }
      : undefined,
  };
}

/**
 * ReAct-style loop: call the LLM with tools, execute any tool calls,
 * feed results back, repeat until the model returns no tool calls or maxSteps hit.
 *
 * Each agent defines its own tools via the `executeTool` callback.
 */
export async function llmAgentLoop(args: {
  systemPrompt: string;
  userMessage: string;
  tools: LLMToolDef[];
  executeTool: (name: string, args: any) => Promise<string>;
  maxSteps?: number;
  temperature?: number;
}): Promise<{ finalContent: string; steps: number; totalTokens: number; toolTrace: Array<{ name: string; args: any; result: string }> }> {
  const maxSteps = args.maxSteps ?? 8;
  const messages: LLMMessage[] = [
    { role: 'system', content: args.systemPrompt },
    { role: 'user', content: args.userMessage },
  ];

  const toolTrace: Array<{ name: string; args: any; result: string }> = [];
  let totalTokens = 0;
  let steps = 0;

  while (steps < maxSteps) {
    steps += 1;
    const res = await llmChat({
      messages,
      tools: args.tools,
      temperature: args.temperature,
    });
    if (res.usage) totalTokens += res.usage.totalTokens;

    // Model returned text without tool call → done
    if (!res.toolCalls || res.toolCalls.length === 0) {
      messages.push({ role: 'assistant', content: res.content });
      return { finalContent: res.content, steps, totalTokens, toolTrace };
    }

    // Push assistant message with tool_calls
    messages.push({
      role: 'assistant',
      content: res.content,
    });

    // Execute each tool call
    for (const tc of res.toolCalls) {
      let parsedArgs: any = {};
      try {
        parsedArgs = JSON.parse(tc.arguments);
      } catch {
        parsedArgs = {};
      }
      let resultText = '';
      try {
        resultText = await args.executeTool(tc.name, parsedArgs);
        if (typeof resultText !== 'string') resultText = JSON.stringify(resultText);
      } catch (e: any) {
        resultText = `Error: ${e?.message ?? e}`;
      }
      toolTrace.push({ name: tc.name, args: parsedArgs, result: resultText });
      messages.push({
        role: 'tool',
        content: resultText.slice(0, 4000), // truncate huge outputs
        tool_call_id: tc.id,
        name: tc.name,
      });
    }
  }

  return {
    finalContent: messages[messages.length - 1]?.content ?? '(max steps reached)',
    steps,
    totalTokens,
    toolTrace,
  };
}