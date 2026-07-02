import { headers } from 'next/headers';
import { prisma } from '@pazzera/core';
import { getCurrentSession } from '@/lib/session';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Real DB-backed feed for the home page.
 * Returns empty arrays when no data exists — NEVER synthesizes.
 *
 * Pulls (real DB only):
 *   - trending: Songs with most successful payments in last 24h
 *   - recently played: current user's last 8 listening events
 *   - featured artists: artists with most lifetime earnings
 *   - new releases: latest 8 uploaded songs
 *   - playlists: real playlists ordered by updatedAt desc
 */

export type FeedTrack = {
  id: string;
  slug: string;
  title: string;
  artistName: string;
  artistId: string;
  artistUsername: string;
  artistAvatarUrl: string | null;
  coverUrl: string | null;
  audioUrl: string | null;
  durationSeconds: number;
  genre: string | null;
  rateUsdc: number;
  publishedPriceUsdc: string;
  totalEarningsUsdc: number;
  totalPlays: number;
};

export type FeedArtist = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  genre: string | null;
  totalEarningsUsdc: number;
  totalTracks: number;
};

export type FeedPlaylist = {
  id: string;
  title: string;
  coverUrl: string | null;
  trackCount: number;
  ownerName: string | null;
  updatedAt: Date;
};

export type HomeFeed = {
  trending: FeedTrack[];
  recentlyPlayed: FeedTrack[];
  featuredArtists: FeedArtist[];
  newReleases: FeedTrack[];
  playlists: FeedPlaylist[];
  hasAnyContent: boolean;
  userIsArtist: boolean;
  totalArtists: number;
  totalTracks: number;
  totalPlays: number;
};

/**
 * USDC amounts in DB are stored as string-formatted decimals (e.g. "0.005" or base units).
 * Convert to number for UI display. If unparseable, return 0.
 */
function parseUsdc(raw: unknown): number {
  if (typeof raw !== 'string' && typeof raw !== 'number') return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

async function safeQuery<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export async function getHomeFeed(): Promise<HomeFeed> {
  let userId: string | null = null;
  try {
    await headers();
    const session = await getCurrentSession();
    userId = session?.userId ?? null;
  } catch {
    userId = null;
  }

  const since = new Date(Date.now() - DAY);

  // ---- Trending: aggregate completed payments in last 24h by song ----
  // Payment.songId is the correct FK.
  const trendingRaw = await safeQuery<
    Array<{
      songId: string;
      _sum: { amountUsdc: any };
      _count: { _all: number };
    }>
  >(
    () =>
      (prisma.payment.groupBy as any)({
        by: ['songId'],
        where: { status: 'completed', settledAt: { gte: since } },
        _sum: { amountUsdc: true },
        _count: { _all: true },
        orderBy: { _sum: { amountUsdc: 'desc' } },
        take: 12,
      }) as any,
    [],
  );

  // Hydrate songs + artist metadata for the trending groupBy
  const trendingSongIds = trendingRaw.map((r) => r.songId);
  const trendingSongs = trendingSongIds.length
    ? await safeQuery(
        () =>
          prisma.song.findMany({
            where: { id: { in: trendingSongIds }, status: 'published' },
            include: {
              artist: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
            },
          }),
        [] as Array<any>,
      )
    : [];
  const songById = new Map<string, any>(trendingSongs.map((s: any) => [s.id, s]));
  const trending: FeedTrack[] = trendingRaw
    .map((r) => {
      const song = songById.get(r.songId);
      if (!song) return null;
      return {
        id: song.id,
        slug: song.slug,
        title: song.title ?? 'Untitled',
        artistName: song.artist?.displayName ?? song.artist?.username ?? song.artistName ?? 'Unknown',
        artistId: song.artist?.id ?? '',
        artistUsername: song.artist?.username ?? song.artistUsername ?? '',
        artistAvatarUrl: song.artist?.avatarUrl ?? null,
        coverUrl: song.coverUrl ?? song.coverThumbUrl ?? null,
        audioUrl: song.audioUrl ?? null,
        durationSeconds: song.durationSeconds ?? 0,
        genre: song.genre ?? null,
        rateUsdc: parseUsdc(song.publishedPriceUsdc ?? song.artistPriceUsdc ?? 0.003),
        publishedPriceUsdc: song.publishedPriceUsdc ?? song.artistPriceUsdc ?? '0.003',
        totalEarningsUsdc: parseUsdc(r._sum.amountUsdc),
        totalPlays: r._count._all,
      } as FeedTrack;
    })
    .filter((t): t is FeedTrack => t !== null);

  // ---- New releases: most recent uploaded songs ----
  const newReleasesRaw = await safeQuery(
    () =>
      prisma.song.findMany({
        where: { status: 'published' },
        orderBy: { publishedAt: 'desc' },
        take: 12,
        include: {
          artist: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        },
      }),
    [] as Array<any>,
  );
  const newReleases: FeedTrack[] = newReleasesRaw.map((t: any) => ({
    id: t.id,
    slug: t.slug,
    title: t.title ?? 'Untitled',
    artistName: t.artist?.displayName ?? t.artist?.username ?? t.artistName ?? 'Unknown',
    artistId: t.artist?.id ?? '',
    artistUsername: t.artist?.username ?? t.artistUsername ?? '',
    artistAvatarUrl: t.artist?.avatarUrl ?? null,
    coverUrl: t.coverUrl ?? t.coverThumbUrl ?? null,
    audioUrl: t.audioUrl ?? null,
    durationSeconds: t.durationSeconds ?? 0,
    genre: t.genre ?? null,
    rateUsdc: parseUsdc(t.publishedPriceUsdc ?? t.artistPriceUsdc ?? 0.003),
    publishedPriceUsdc: t.publishedPriceUsdc ?? t.artistPriceUsdc ?? '0.003',
    totalEarningsUsdc: 0,
    totalPlays: 0,
  }));

  // ---- Featured artists: real artists ordered by lifetime payment income ----
  // Artist ID on Payment? Let's check via payout-by-artist OR sum amountUsdc of song streams to that artist's songs
  // Strategy: total artist earnings = sum(payments.amountUsdc for songs where artistId = X AND status=completed)
  type ArtistAggRow = { artistId: string; totalEarningsUsdc: number; totalTracks: number };

  // Use raw SQL for the join group by since Prisma doesn't allow joining Payment→Song in groupBy easily
  const artistsAggRaw = await safeQuery<Array<{ artistId: string; total: any; count: number }>>(
    async () => {
      // Note: prisma.$queryRaw requires a properly typed call; cast to any for resilience
      return (await (prisma as any).$queryRaw`
        SELECT s."artistId" AS "artistId",
               SUM(CAST(p."amountUsdc" AS NUMERIC)) AS "total",
               COUNT(DISTINCT s.id)::int AS "count"
        FROM "Payment" p
        INNER JOIN "Song" s ON s.id = p."songId"
        WHERE p."status" = 'completed'
        GROUP BY s."artistId"
        ORDER BY "total" DESC
        LIMIT 12
      `) as Array<{ artistId: string; total: any; count: number }>;
    },
    [],
  );

  const artistsAgg: ArtistAggRow[] = artistsAggRaw.map((r) => ({
    artistId: r.artistId,
    totalEarningsUsdc: typeof r.total === 'string' || typeof r.total === 'number' ? parseUsdc(r.total) : 0,
    totalTracks: r.count ?? 0,
  }));

  const featuredArtists: FeedArtist[] = artistsAgg.length
    ? (await safeQuery(async () => {
        const users = await prisma.user.findMany({
          where: { id: { in: artistsAgg.map((a) => a.artistId) } },
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        });
        return artistsAgg.map((agg) => {
          const u = users.find((x) => x.id === agg.artistId);
          return {
            id: agg.artistId,
            username: u?.username ?? 'unknown',
            displayName: u?.displayName ?? null,
            avatarUrl: u?.avatarUrl ?? null,
            genre: null,
            totalEarningsUsdc: agg.totalEarningsUsdc,
            totalTracks: agg.totalTracks,
          } as FeedArtist;
        });
      }, [] as FeedArtist[]))
    : [];

  // ---- Recently played (only if signed in) ----
  let recentlyPlayed: FeedTrack[] = [];
  if (userId) {
    const recentListens = await safeQuery(
      () =>
        prisma.stream.findMany({
          where: { userId, endReason: { not: null } },
          orderBy: { startedAt: 'desc' },
          take: 8,
          include: {
            song: {
              include: {
                artist: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
              },
            },
          },
        }),
      [] as Array<any>,
    );
    recentlyPlayed = recentListens
      .filter((s: any) => s.song)
      .map((s: any) => {
        const t = s.song;
        return {
          id: t.id,
          slug: t.slug,
          title: t.title ?? 'Untitled',
          artistName: t.artist?.displayName ?? t.artist?.username ?? t.artistName ?? 'Unknown',
          artistId: t.artist?.id ?? '',
          artistUsername: t.artist?.username ?? t.artistUsername ?? '',
          artistAvatarUrl: t.artist?.avatarUrl ?? null,
          coverUrl: t.coverUrl ?? t.coverThumbUrl ?? null,
          audioUrl: t.audioUrl ?? null,
          durationSeconds: t.durationSeconds ?? 0,
          genre: t.genre ?? null,
          rateUsdc: parseUsdc(t.publishedPriceUsdc ?? t.artistPriceUsdc ?? 0.003),
          publishedPriceUsdc: t.publishedPriceUsdc ?? t.artistPriceUsdc ?? '0.003',
          totalEarningsUsdc: 0,
          totalPlays: 0,
        } as FeedTrack;
      });
  }

  // ---- Playlists (real) ----
  const playlistsRaw = await safeQuery(
    () => (prisma as any).playlist?.findMany
      ? (prisma as any).playlist.findMany({
          orderBy: { updatedAt: 'desc' },
          take: 8,
          include: { owner: { select: { username: true, displayName: true } } },
        })
      : Promise.resolve([]),
    [] as Array<any>,
  );
  const playlists: FeedPlaylist[] = (playlistsRaw as Array<any>).map((p: any) => ({
    id: p.id,
    title: p.title ?? 'Untitled',
    coverUrl: p.coverUrl ?? null,
    trackCount: parseUsdc(p.trackCount) | 0,
    ownerName: p.owner?.displayName ?? p.owner?.username ?? null,
    updatedAt: p.updatedAt ?? new Date(0),
  }));

  const hasAnyContent =
    trending.length > 0 ||
    newReleases.length > 0 ||
    featuredArtists.length > 0 ||
    playlists.length > 0 ||
    recentlyPlayed.length > 0;

  let userIsArtist = false;
  if (userId) {
    const u = await safeQuery(
      () => prisma.user.findUnique({ where: { id: userId }, select: { isArtist: true, role: true } }),
      null,
    );
    if (u) {
      userIsArtist = Boolean(u.isArtist) || u.role === 'artist' || u.role === 'admin';
    }
  }

  // Global totals (real)
  const totalArtists = await safeQuery(() => prisma.user.count({ where: { OR: [{ isArtist: true }, { role: 'artist' }] } }), 0);
  const totalTracks = await safeQuery(() => prisma.song.count(), 0);
  const totalPlaysRaw = await safeQuery(
    () => prisma.stream.count({ where: { endReason: { not: null } } }),
    0,
  );

  return {
    trending,
    recentlyPlayed,
    featuredArtists,
    newReleases,
    playlists,
    hasAnyContent,
    userIsArtist,
    totalArtists,
    totalTracks,
    totalPlays: totalPlaysRaw,
  };
}