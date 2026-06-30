/**
 * Song repository.
 */
import { prisma } from '../client';

export type SongCreateInput = {
  slug: string;
  title: string;
  artistId: string;
  artistName: string;
  artistUsername: string;
  featuredNames?: string[];
  producerName?: string | null;
  description?: string | null;
  coverKey: string;
  coverUrl: string;
  audioKey: string;
  audioUrl: string;
  durationSeconds: number;
  artistPriceUsdc: string;
  audioBitrateKbps?: number;
  audioSampleRateHz?: number;
  audioChannels?: number;
  audioPeakDb?: number;
  audioHash?: string;
};

export const SongRepo = {
  async create(data: SongCreateInput) {
    return prisma.song.create({
      data: { ...data, status: 'uploaded', featuredNames: data.featuredNames ?? [] },
    });
  },
  async findById(id: string) {
    return prisma.song.findUnique({
      where: { id },
      include: { recipients: { include: { user: { include: { wallet: true } } } } },
    });
  },
  async findBySlug(slug: string) {
    return prisma.song.findUnique({
      where: { slug },
      include: { recipients: { include: { user: { include: { wallet: true } } } } },
    });
  },
  async transition(songId: string, to: 'draft' | 'uploaded' | 'under_review' | 'approved' | 'published' | 'rejected' | 'suspended', extra?: Record<string, unknown>) {
    return prisma.song.update({
      where: { id: songId },
      data: { status: to, ...(to === 'published' ? { publishedAt: new Date(), isPublic: true } : {}), ...(extra ?? {}) },
    });
  },
  async markCuratorDecision(
    songId: string,
    decision: {
      decision: 'approved' | 'rejected' | 'needs_changes' | 'suspended';
      publishedPriceUsdc: string;
      scores: { metadata: number; audio: number; spam: number; duplicate: number; market: number; total: number };
      reasons: string[];
    },
  ) {
    return prisma.song.update({
      where: { id: songId },
      data: {
        curatorStatus: decision.decision,
        curatorScoreTotal: decision.scores.total,
        curatorScoreMetadata: decision.scores.metadata,
        curatorScoreAudio: decision.scores.audio,
        curatorScoreSpam: decision.scores.spam,
        curatorScoreDuplicate: decision.scores.duplicate,
        curatorScoreMarket: decision.scores.market,
        curatorReasons: decision.reasons,
        curatorReviewedAt: new Date(),
        publishedPriceUsdc: decision.publishedPriceUsdc,
        // Auto-publish on approval
        status: decision.decision === 'approved' ? 'published' : decision.decision,
        isPublic: decision.decision === 'approved',
        publishedAt: decision.decision === 'approved' ? new Date() : null,
      },
    });
  },
  async listPublishedCatalog(opts: { skip?: number; take?: number; orderBy?: 'recent' | 'trending' }) {
    const orderBy =
      opts.orderBy === 'trending'
        ? { playCount: 'desc' as const }
        : { publishedAt: 'desc' as const };
    return prisma.song.findMany({
      where: { isPublic: true, status: 'published' },
      orderBy,
      skip: opts.skip ?? 0,
      take: opts.take ?? 20,
      select: {
        id: true,
        slug: true,
        title: true,
        artistName: true,
        artistUsername: true,
        coverUrl: true,
        durationSeconds: true,
        publishedPriceUsdc: true,
        playCount: true,
      },
    });
  },
  async search(query: string, opts: { take?: number }) {
    return prisma.song.findMany({
      where: {
        isPublic: true,
        status: 'published',
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { artistName: { contains: query, mode: 'insensitive' } },
          { artistUsername: { contains: query, mode: 'insensitive' } },
          { featuredNames: { has: query } },
          { producerName: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: opts.take ?? 25,
      orderBy: { playCount: 'desc' },
      select: {
        id: true,
        slug: true,
        title: true,
        artistName: true,
        artistUsername: true,
        coverUrl: true,
        durationSeconds: true,
        publishedPriceUsdc: true,
      },
    });
  },
  async incrementPlayCount(songId: string) {
    return prisma.song.update({
      where: { id: songId },
      data: { playCount: { increment: 1 } },
    });
  },
  async byArtist(artistId: string) {
    return prisma.song.findMany({
      where: { artistId },
      orderBy: { createdAt: 'desc' },
    });
  },
};