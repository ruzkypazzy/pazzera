/**
 * POST /api/agent/upload/commit
 *
 * Body: { sessionId: string }
 *
 * Takes the agent's draft (title, description, recipients, price) and
 * drives the LOCKED /api/songs/create-draft + /api/upload/{audio,cover,finalize}
 * pipeline internally. Returns { songId, slug, status } on success.
 *
 * ADDITIVE — does not modify any existing route.
 */

import { withApi, requireSession, AppError, prisma } from '@pazzera/core';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const AGENT_STAGE_DIR = '/app/data/agent-stage';

const Body = z.object({
  sessionId: z.string(),
});

export const POST = withApi(
  async ({ req }) => {
    const session = await requireSession();
    const { getParsedBody } = await import('@pazzera/core');
    const body = getParsedBody<z.infer<typeof Body>>(req);
    Body.parse(body);

    const row = await prisma.agentUploadSession.findUnique({ where: { id: body.sessionId } });
    if (!row || row.userId !== session.userId) {
      throw new AppError('NOT_FOUND', 'Session not found', 404);
    }
    const state = (row.state ?? {}) as {
      draft?: {
        title?: string;
        description?: string;
        streamRateUsdc?: number;
        recipients?: Array<{
          username: string;
          role: 'primary_artist' | 'featured_artist' | 'producer' | 'songwriter' | 'label' | 'custom';
          percentageBps: number;
          type: 'internal' | 'external';
          resolvedUserId?: string;
          resolution?: 'ok' | 'not_found' | 'external';
        }>;
        audioStorageKey?: string;
        coverStorageKey?: string;
      };
    };
    const draft = state.draft ?? {};
    if (!draft.title) throw new AppError('BAD_REQUEST', 'Title missing', 400);
    if (!draft.recipients || draft.recipients.length === 0) {
      throw new AppError('BAD_REQUEST', 'Recipients missing', 400);
    }
    if (!draft.audioStorageKey) throw new AppError('BAD_REQUEST', 'Audio missing — re-upload', 400);
    if (!draft.coverStorageKey) throw new AppError('BAD_REQUEST', 'Cover missing — re-upload', 400);
    if (draft.streamRateUsdc === undefined) throw new AppError('BAD_REQUEST', 'Rate missing', 400);

    // 1. Create draft song
    const csrf = getCookieFromReq(req) ?? '';
    const baseUrl = process.env.PUBLIC_BASE_URL ?? 'https://pazzera.com';
    const headers = {
      'content-type': 'application/json',
      cookie: req.headers.get('cookie') ?? '',
      'x-csrf-token': csrf,
    };

    const draftRes = await fetch(`${baseUrl}/api/songs/create-draft`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: draft.title, description: draft.description ?? '', genre: 'house', language: 'en' }),
    });
    const draftJson = await draftRes.json().catch(() => ({}));
    if (!draftRes.ok) {
      throw new AppError('BAD_GATEWAY', draftJson?.error?.message ?? 'create-draft failed', 502);
    }
    const songId: string = draftJson.songId ?? draftJson.id;

    // 2. Upload audio via multipart (works for both STORAGE_PROVIDER=local
    //    and R2; the route itself decides which path to take).
    const audioKey = draft.audioStorageKey;
    const audioPath = path.join(AGENT_STAGE_DIR, audioKey);
    const audioStat = await fs.stat(audioPath).catch(() => null);
    if (!audioStat) throw new AppError('NOT_FOUND', 'Staged audio file gone', 404);
    if (!Number.isFinite(audioStat.size) || audioStat.size <= 0) {
      throw new AppError('BAD_REQUEST', 'Staged audio file is empty', 400);
    }
    const audioBuf = await fs.readFile(audioPath);
    const audioMime = guessMimeFromExt(audioKey, 'audio');

    const audioForm = new FormData();
    audioForm.append('songId', songId);
    audioForm.append('file', new Blob([audioBuf], { type: audioMime }), audioKey);

    const audioRes = await fetch(`${baseUrl}/api/upload/audio`, {
      method: 'POST',
      headers: { cookie: req.headers.get('cookie') ?? '', 'x-csrf-token': csrf },
      body: audioForm,
    });
    const audioJson = await audioRes.json().catch(() => ({}));
    if (!audioRes.ok) {
      throw new AppError('BAD_GATEWAY', audioJson?.error?.message ?? `audio upload ${audioRes.status}`, 502);
    }
    const uploadedAudioKey: string = audioJson.key;

    // 3. Upload cover via multipart (same pattern).
    const coverKey = draft.coverStorageKey;
    const coverPath = path.join(AGENT_STAGE_DIR, coverKey);
    const coverStat = await fs.stat(coverPath).catch(() => null);
    if (!coverStat) throw new AppError('NOT_FOUND', 'Staged cover file gone', 404);
    const coverBuf = await fs.readFile(coverPath);
    const coverMime = guessMimeFromExt(coverKey, 'image');

    const coverForm = new FormData();
    coverForm.append('songId', songId);
    coverForm.append('file', new Blob([coverBuf], { type: coverMime }), coverKey);

    const coverRes = await fetch(`${baseUrl}/api/upload/cover`, {
      method: 'POST',
      headers: { cookie: req.headers.get('cookie') ?? '', 'x-csrf-token': csrf },
      body: coverForm,
    });
    const coverJson = await coverRes.json().catch(() => ({}));
    if (!coverRes.ok) {
      throw new AppError('BAD_GATEWAY', coverJson?.error?.message ?? `cover upload ${coverRes.status}`, 502);
    }
    const uploadedCoverKey: string = coverJson.key;

    // 4. Finalize — build the proper metadata + recipients payload.
    //    We need the artist's displayName (for metadata.artistName).
    const me = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { displayName: true, username: true },
    });
    const artistName = me?.displayName ?? me?.username ?? 'Unknown Artist';

    // Resolve recipient displayName; if a recipient is internal but
    // missing a resolvedUserId, look it up. Finalize refuses unknown
    // Pazzera usernames, so we either resolve them or skip with error.
    // Skip blank/invalid rows (e.g., an empty producer slot the user
    // never filled in) — they only matter if percentageBps > 0.
    const resolvedRecipients: Array<Record<string, unknown>> = [];
    for (const r of draft.recipients) {
      const cleanUsername = (r.username ?? '').replace(/^@/, '').trim();
      // Skip empty username OR 0% percentage — both mean "this slot is unused".
      if (!cleanUsername || (r.percentageBps ?? 0) <= 0) {
        continue;
      }
      if (r.type === 'internal') {
        const u = await prisma.user.findUnique({
          where: { username: cleanUsername },
          select: { id: true, username: true, displayName: true },
        });
        if (!u) {
          throw new AppError('BAD_REQUEST', `Unknown Pazzera user: @${cleanUsername}`, 400);
        }
        resolvedRecipients.push({
          type: 'internal',
          username: u.username,
          displayName: u.displayName ?? u.username,
          role: r.role,
          percentageBps: r.percentageBps,
        });
      } else {
        // external — the agent flow only handles internal splits today.
        throw new AppError(
          'BAD_REQUEST',
          `External recipient @${cleanUsername} needs a wallet address; the AI Agent only handles internal splits for now.`,
          400,
        );
      }
    }

    const finalizeBody = {
      songId,
      priceUsdc: String(draft.streamRateUsdc),
      metadata: {
        title: draft.title,
        artistName,
        featuredNames: resolvedRecipients.filter((r) => r.role === 'featured_artist').map((r) => String(r.displayName)),
        producerName: resolvedRecipients.find((r) => r.role === 'producer')?.displayName as string ?? null,
        description: draft.description ?? null,
        // Duration is extracted by the audio pipeline later; pass the
        // minimum allowed so finalize's schema accepts it.
        durationSeconds: 30,
        audioKey: uploadedAudioKey,
        coverKey: uploadedCoverKey,
      },
      recipients: resolvedRecipients,
    };

    const finalizeRes = await fetch(`${baseUrl}/api/upload/finalize`, {
      method: 'POST',
      headers,
      body: JSON.stringify(finalizeBody),
    });
    const finalizeJson = await finalizeRes.json().catch(() => ({}));
    if (!finalizeRes.ok) {
      throw new AppError('BAD_GATEWAY', finalizeJson?.error?.message ?? 'finalize failed', 502);
    }

    // 5. Mark the agent session as committed + close it
    await prisma.agentUploadSession.update({
      where: { id: row.id },
      data: {
        songId,
        closedAt: new Date(),
        state: {
          ...state,
          state: 'committed',
          songId,
        } as unknown as object,
      },
    });

    // 6. Best-effort cleanup of stage files
    try { await fs.unlink(audioPath); } catch { /* ignore */ }
    try { await fs.unlink(coverPath); } catch { /* ignore */ }

    return new Response(
      JSON.stringify({ ok: true, songId, slug: finalizeJson.slug ?? null, status: 'processing' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  },
  { requireAuth: true, requireCsrf: true, bodySchema: Body },
);

function guessMimeFromExt(filename: string, kind: 'audio' | 'image'): string {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  if (kind === 'audio') {
    if (ext === 'mp3') return 'audio/mpeg';
    if (ext === 'wav') return 'audio/wav';
    if (ext === 'm4a') return 'audio/mp4';
    if (ext === 'flac') return 'audio/flac';
    return 'application/octet-stream';
  }
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

function getCookieFromReq(req: Request): string | null {
  const raw = req.headers.get('cookie') ?? '';
  const m = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith('csrf='));
  return m?.split('=')[1] ?? null;
}