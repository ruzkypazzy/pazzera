/**
 * GET  /api/agent/upload/message?sessionId=xxx
 *      Returns the full session (state + messages) for the chat panel.
 *      If no sessionId, returns the user's most recent open session, or
 *      null if none exists.
 *
 * POST /api/agent/upload/message
 *      Body: { sessionId?: string, input: HandleInput, audioFile?: File, coverFile?: File }
 *      For 'audio' / 'cover' inputs, the multipart file is uploaded to
 *      local storage (separate from the LOCKED pipeline), then the agent
 *      router is invoked. The cover bytes are passed inline as a data:
 *      URL to OpenAI vision (no auth needed for the LLM to read them).
 *      For 'commit' input, the agent calls the LOCKED
 *      /api/upload/{audio,cover,finalize} pipeline internally and
 *      returns the new songId.
 *
 * ADDITIVE — does not modify any existing route. Uses the LOCKED
 * Prisma model AgentUploadSession (added 2026-07-04).
 */

import { z } from 'zod';
import {
  withApi,
  requireSession,
  AppError,
  prisma,
} from '@pazzera/core';
import {
  handleInput,
  buildInitialGreeting,
  appendMessage,
  updateSessionState,
  type HandleInput,
  type AgentMessage,
  type AgentSessionState,
} from '@pazzera/agents/upload-agent/router';
import { llmHealth } from '@pazzera/agents/upload-agent/llm';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const AGENT_STAGE_DIR = '/app/data/agent-stage';

async function ensureStageDir(): Promise<void> {
  try {
    await fs.mkdir(AGENT_STAGE_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

async function saveStageFile(
  stage: 'audio' | 'cover',
  sessionId: string,
  filename: string,
  file: File,
): Promise<{ storageKey: string }> {
  await ensureStageDir();
  const ext = path.extname(filename) || (stage === 'audio' ? '.mp3' : '.jpg');
  const key = `${sessionId}-${stage}-${Date.now()}${ext}`;
  const localPath = path.join(AGENT_STAGE_DIR, key);
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(localPath, buf);
  return { storageKey: key };
}

function inferExt(filename: string, fallback: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext) return ext;
  return fallback;
}

// ---------- GET ---------------------------------------------------------
export const GET = withApi(
  async ({ req }) => {
    const session = await requireSession();
    const url = new URL(req.url);
    const sessionId = url.searchParams.get('sessionId');

    if (sessionId) {
      const row = await prisma.agentUploadSession.findUnique({ where: { id: sessionId } });
      if (!row || row.userId !== session.userId) {
        throw new AppError('NOT_FOUND', 'Session not found', 404);
      }
      return new Response(
        JSON.stringify({ ok: true, session: row, health: llmHealth() }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    const open = await prisma.agentUploadSession.findFirst({
      where: { userId: session.userId, closedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
    return new Response(
      JSON.stringify({ ok: true, session: open, health: llmHealth() }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  },
  { requireAuth: true },
);

// ---------- POST --------------------------------------------------------
// Accepts multipart/form-data OR application/json.
export const POST = withApi(
  async ({ req }) => {
    const session = await requireSession();
    const me = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, isArtist: true, username: true, displayName: true },
    });
    if (!me?.isArtist) {
      throw new AppError('FORBIDDEN', 'Only artists can use the upload agent', 403);
    }

    const contentType = req.headers.get('content-type') ?? '';
    let sessionId: string | null = null;
    let input: HandleInput | null = null;
    let audioFile: File | null = null;
    let coverFile: File | null = null;

    if (contentType.startsWith('multipart/form-data')) {
      const form = await req.formData();
      sessionId = (form.get('sessionId') as string | null) || null;
      const inputStr = (form.get('input') as string | null) || null;
      if (inputStr) input = JSON.parse(inputStr) as HandleInput;
      const audio = form.get('audioFile');
      if (audio instanceof File) audioFile = audio;
      const cover = form.get('coverFile');
      if (cover instanceof File) coverFile = cover;
    } else {
      const Body = z.object({
        sessionId: z.string().nullable().optional(),
        input: z.any(),
      });
      // withApi only parses the body when a bodySchema is provided in the
      // route options, which we don't use. Read the body directly.
      const raw = await req.json().catch(() => ({}));
      const parsed = Body.parse(raw);
      sessionId = parsed.sessionId ?? null;
      input = parsed.input as HandleInput;
    }

    if (!input) {
      throw new AppError('BAD_REQUEST', 'Missing input', 400);
    }

    // ---- Create / fetch session -----------------------------------------
    let row = sessionId
      ? await prisma.agentUploadSession.findUnique({ where: { id: sessionId } })
      : null;
    if (row && row.userId !== session.userId) {
      throw new AppError('FORBIDDEN', 'Not your session', 403);
    }
    if (!row) {
      const initialState: AgentSessionState = {
        id: '',
        userId: session.userId,
        state: 'idle',
        draft: {},
        llm: llmHealth(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const greeting: AgentMessage = buildInitialGreeting(me.username ?? undefined);
      row = await prisma.agentUploadSession.create({
        data: {
          userId: session.userId,
          state: initialState as unknown as object,
          messages: [greeting] as unknown as object,
        },
      });
    }

    // ---- Persist the user message first ---------------------------------
    if (input.kind === 'text') {
      const userMsg: AgentMessage = {
        id: `msg_user_${Date.now()}`,
        role: 'user',
        kind: 'chat',
        text: input.text,
        createdAt: new Date().toISOString(),
      };
      await appendMessage(prisma, row.id, userMsg);
    } else if (input.kind === 'audio' && audioFile) {
      const { storageKey } = await saveStageFile('audio', row.id, audioFile.name, audioFile);
      input = { kind: 'audio', fileName: audioFile.name, storageKey };
      const userMsg: AgentMessage = {
        id: `msg_user_${Date.now()}`,
        role: 'user',
        kind: 'chat',
        text: `[audio] ${audioFile.name}`,
        payload: { fileName: audioFile.name, size: audioFile.size },
        createdAt: new Date().toISOString(),
      };
      await appendMessage(prisma, row.id, userMsg);
    } else if (input.kind === 'cover' && coverFile) {
      const { storageKey } = await saveStageFile('cover', row.id, coverFile.name, coverFile);
      // OpenAI vision can't reach our auth-protected URLs. Pass a
      // data: URL so the LLM fetches bytes directly.
      const buf = await fs.readFile(path.join(AGENT_STAGE_DIR, storageKey));
      const ext = inferExt(coverFile.name, '.jpg').replace('.', '').toLowerCase();
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
      input = { kind: 'cover', fileName: coverFile.name, storageKey, coverUrl: dataUrl };
      const userMsg: AgentMessage = {
        id: `msg_user_${Date.now()}`,
        role: 'user',
        kind: 'chat',
        text: `[cover] ${coverFile.name}`,
        payload: { fileName: coverFile.name, size: coverFile.size },
        createdAt: new Date().toISOString(),
      };
      await appendMessage(prisma, row.id, userMsg);
    } else if (
      input.kind === 'commit' ||
      input.kind === 'rate' ||
      input.kind === 'recipient_pct' ||
      input.kind === 'recipient_username' ||
      input.kind === 'reset'
    ) {
      // typed inputs, no extra persistence
    } else {
      throw new AppError(
        'BAD_REQUEST',
        `Unsupported input kind: ${(input as { kind: string }).kind}`,
        400,
      );
    }

    // ---- Run the router -------------------------------------------------
    const currentState = (row.state ?? {}) as AgentSessionState;
    const getFilePath = async (storageKey: string): Promise<string> =>
      path.join(AGENT_STAGE_DIR, storageKey);

    const { nextState, assistantMessages } = await handleInput({
      prisma,
      session: { ...currentState, messages: (row.messages ?? []) as Array<{ role: 'user' | 'assistant'; text: string }> },
      input,
      getFilePath,
      artistPrimary: { username: me.username ?? 'artist', userId: me.id },
    });

    // ---- Persist new state + assistant messages -------------------------
    for (const m of assistantMessages) {
      await appendMessage(prisma, row.id, m);
    }
    await updateSessionState(
      prisma,
      row.id,
      nextState.state,
      nextState.draft as Record<string, unknown>,
    );

    const fresh = await prisma.agentUploadSession.findUnique({ where: { id: row.id } });

    return new Response(
      JSON.stringify({ ok: true, session: fresh }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  },
  { requireAuth: true, requireCsrf: true },
);