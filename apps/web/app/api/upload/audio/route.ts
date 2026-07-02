/**
 * POST /api/upload/audio
 *
 * Two modes:
 *   1. JSON body  ->  validate + return a presigned PUT URL
 *                     (used in production with R2 / S3 — the client PUTs
 *                     the file directly to storage)
 *   2. multipart  ->  server-mediated upload
 *                     (used in local dev with STORAGE_PROVIDER=local —
 *                     the server reads the FormData and writes through
 *                     the LocalService.put() helper)
 *
 * Either way the response contains `key`, which finalize uses to bind
 * the song to the uploaded file.
 */
import { z } from 'zod';
import {
  withApi,
  requireSession,
  AppError,
  getStorageService,
  getEnv,
  prisma,
} from '@pazzera/core';
import { makeAudioKey, AUDIO_MAX_BYTES } from '@pazzera/storage';
import { validateAudio } from '@pazzera/upload/validation';

const Body = z.object({
  songId: z.string().min(1),
  filename: z.string().min(1).max(255),
  mime: z.string().min(1).max(120),
  size: z.number().int().positive().max(AUDIO_MAX_BYTES),
});

export const POST = withApi(
  async ({ req }) => {
    const session = await requireSession();
    const { getParsedBody } = await import('@pazzera/core');
    const env = getEnv();

    const contentType = req.headers.get('content-type') ?? '';

    // ─── Multipart / server-mediated upload (local dev) ─────────────
    if (contentType.startsWith('multipart/form-data')) {
      if (env.STORAGE_PROVIDER !== 'local') {
        throw new AppError(
          'CONFLICT',
          'Server-mediated upload is only enabled when STORAGE_PROVIDER=local',
          409,
        );
      }
      const form = await req.formData();
      const file = form.get('file');
      const songId = String(form.get('songId') ?? '');
      if (!songId) throw new AppError('BAD_REQUEST', 'songId is required', 400);
      if (!(file instanceof File)) {
        throw new AppError('BAD_REQUEST', 'file is required', 400);
      }
      const filename = file.name || 'audio.mp3';
      const mime = file.type || 'application/octet-stream';
      const size = file.size;

      const v = validateAudio(filename, mime, size);
      if (!v.ok) {
        throw new AppError('VALIDATION_ERROR', (v as { reason: string }).reason, 400);
      }

      const song = await prisma.song.findUnique({
        where: { id: songId },
        select: { id: true, artistId: true, status: true },
      });
      if (!song) throw new AppError('NOT_FOUND', 'Song not found', 404);
      if (song.artistId !== session.userId) {
        throw new AppError('FORBIDDEN', 'Not the song owner', 403);
      }
      if (!['draft', 'failed_processing', 'uploading'].includes(song.status)) {
        throw new AppError(
          'CONFLICT',
          `Cannot upload audio in status ${song.status}`,
          409,
        );
      }

      const storage = getStorageService();
      const key = makeAudioKey(song.id, v.ext);
      const arrayBuffer = await file.arrayBuffer();
      await storage.put({
        key,
        contentType: v.mime,
        body: Buffer.from(arrayBuffer),
      });

      await prisma.song.update({
        where: { id: song.id },
        data: {
          audioKey: key,
          audioUrl: '',
          status: 'uploading',
        },
      });

      return new Response(
        JSON.stringify({ ok: true, key }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    // ─── JSON / presigned URL path (R2 / S3) ───────────────────────
    const body = getParsedBody<z.infer<typeof Body>>(req);

    const v = validateAudio(body.filename, body.mime, body.size);
    if (!v.ok) {
      throw new AppError('VALIDATION_ERROR', (v as { reason: string }).reason, 400);
    }

    const song = await prisma.song.findUnique({
      where: { id: body.songId },
      select: { id: true, artistId: true, status: true },
    });
    if (!song) throw new AppError('NOT_FOUND', 'Song not found', 404);
    if (song.artistId !== session.userId) {
      throw new AppError('FORBIDDEN', 'Not the song owner', 403);
    }
    if (!['draft', 'failed_processing', 'uploading'].includes(song.status)) {
      throw new AppError('CONFLICT', `Cannot upload audio in status ${song.status}`, 409);
    }

    const storage = getStorageService();
    const key = makeAudioKey(song.id, v.ext);
    const { url, expiresAt } = await storage.getPresignedPutUrl({
      key,
      contentType: v.mime,
      maxBytes: body.size,
      minBytes: 1,
      expiresInSec: 600,
    });

    await prisma.$transaction([
      prisma.uploadSession.create({
        data: {
          userId: session.userId,
          songId: song.id,
          kind: 'audio',
          storageKey: key,
          presignedUrl: url,
          expiresAt,
          expectedMime: v.mime,
          expectedSizeBytes: body.size,
          expectedExt: v.ext,
        },
      }),
      prisma.song.update({
        where: { id: song.id },
        data: {
          audioKey: key,
          audioUrl: '',
          status: 'uploading',
        },
      }),
    ]);

    return new Response(
      JSON.stringify({
        ok: true,
        uploadId: `audio-${song.id}`,
        key,
        url,
        expiresAt: expiresAt.toISOString(),
        method: 'PUT',
        headers: { 'content-type': v.mime },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  },
  { bodySchema: Body, requireAuth: true, requireCsrf: true },
);
