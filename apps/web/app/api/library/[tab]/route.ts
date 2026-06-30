/**
 * GET /api/library/[tab] — returns the user's library items by tab.
 * tabs: liked | playlists | recent | downloads
 *
 * "liked" / "playlists" / "downloads" are placeholders for the demo.
 * "recent" returns the last 20 streams for the user.
 */
import { withApi, prisma, requireSession } from '@pazzera/core';

export const GET = withApi(async ({ req }) => {
  const session = await requireSession();
  const url = new URL(req.url);
  const parts = url.pathname.split('/');
  const tab = parts[parts.length - 1] ?? 'recent';

  if (tab === 'recent') {
    const recent = await prisma.stream.findMany({
      where: { userId: session.userId },
      orderBy: { startedAt: 'desc' },
      take: 20,
      include: {
        song: { select: { id: true, title: true, artistName: true, coverUrl: true, durationSeconds: true, publishedPriceUsdc: true } },
      },
    });
    return new Response(
      JSON.stringify({
        items: recent.map((r) => ({
          id: r.song.id,
          title: r.song.title,
          artist: r.song.artistName,
          coverUrl: r.song.coverUrl,
          durationSec: r.song.durationSeconds,
          publishedPriceUsdc: r.song.publishedPriceUsdc,
          playedAt: r.startedAt.toISOString(),
        })),
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  // Placeholders — liked/playlists/downloads land post-hackathon
  return new Response(JSON.stringify({ items: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});