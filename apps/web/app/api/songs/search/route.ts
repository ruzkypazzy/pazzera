/**
 * GET /api/songs/search?q=...
 * Returns songs, artists, and users that match.
 */
import { withApi, prisma } from '@pazzera/core';

export const GET = withApi(async ({ req }) => {
  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  if (q.length < 1) {
    return new Response(JSON.stringify({ songs: [], artists: [], users: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  const [songs, artists, users] = await Promise.all([
    prisma.song.findMany({
      where: {
        isPublic: true,
        status: 'published',
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { artistName: { contains: q, mode: 'insensitive' } },
          { artistUsername: { contains: q, mode: 'insensitive' } },
          { featuredNames: { has: q } },
          { producerName: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 12,
      orderBy: { playCount: 'desc' },
      select: {
        id: true,
        title: true,
        artistName: true,
        artistUsername: true,
        coverUrl: true,
        publishedPriceUsdc: true,
      },
    }),
    prisma.user.findMany({
      where: {
        isArtist: true,
        OR: [
          { username: { contains: q, mode: 'insensitive' } },
          { displayName: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 8,
      select: { id: true, username: true, displayName: true, avatarUrl: true },
    }),
    prisma.user.findMany({
      where: {
        OR: [
          { username: { contains: q, mode: 'insensitive' } },
          { displayName: { contains: q, mode: 'insensitive' } },
        ],
        isArtist: false,
      },
      take: 8,
      select: { id: true, username: true, displayName: true, avatarUrl: true },
    }),
  ]);
  return new Response(JSON.stringify({ songs, artists, users }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});