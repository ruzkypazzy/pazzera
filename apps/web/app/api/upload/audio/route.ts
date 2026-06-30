/**
 * POST /api/upload/audio
 *
 * Validates MIME + size, validates song exists and is in the right
 * state, then issues a presigned URL for direct-to-R2 upload.
 *
 * Body: { songId, filename, mime, size }
 */
import { z } from 'zod';
import {
  withApi,
  requireSession,
  AppError,
  getStorageService,
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
    const body = getParsedBody<z.infer<typeof Body>>(req);

    const v = validateAudio(body.filename, body.mime, body.size);
    if (!v.ok) {
      throw new AppError('VALIDATION_ERROR', v.reason, 400);
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