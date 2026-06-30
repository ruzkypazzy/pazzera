/**
 * GET /api/upload/status/[id]
 * Returns the current pipeline status for a song.
 */
import { withApi, requireSession, prisma, AppError } from '@pazzera/core';

export const GET = withApi(async ({ req }) => {
  const session = await requireSession();
  const url = new URL(req.url);
  const parts = url.pathname.split('/');
  const id = parts[parts.length - 1] ?? '';
  const song = await prisma.song.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      status: true,
      artistId: true,
      audioKey: true,
      coverKey: true,
      previewKey: true,
      waveformKey: true,
      coverThumbKey: true,
      coverMediumKey: true,
      durationSeconds: true,
      audioBitrateKbps: true,
      audioSampleRateHz: true,
      audioChannels: true,
      audioPeakDb: true,
      audioCodec: true,
      audioLufsIntegrated: true,
      audioLufsRange: true,
      audioTruePeakDb: true,
      audioHash: true,
      acousticHash: true,
      coverWidthPx: true,
      coverHeightPx: true,
      coverIsSquare: true,
      errorStep: true,
      errorMessage: true,
      errorRetries: true,
      publishedPriceUsdc: true,
      curatorStatus: true,
      isPublic: true,
    },
  });
  if (!song) throw new AppError('NOT_FOUND', 'Song not found', 404);
  if (song.artistId !== session.userId) {
    // Also allow admin
    const { UserRepo } = await import('@pazzera/db/repositories');
    const admin = await UserRepo.isAdmin(session.userId);
    if (!admin) throw new AppError('FORBIDDEN', 'Not the song owner', 403);
  }
  return new Response(JSON.stringify({ ok: true, song }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});