/**
 * Stream + PlaybackTick repository.
 */
import { prisma } from '../client';

export const StreamRepo = {
  async startStream(data: { userId: string; songId: string; ipAddress?: string; userAgent?: string; deviceFingerprintId?: string }) {
    // Enforce 1 active stream per user
    return prisma.$transaction(async (tx) => {
      const existing = await tx.stream.findFirst({
        where: { userId: data.userId, endedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      if (existing) {
        // Abort the previous one
        await tx.stream.update({
          where: { id: existing.id },
          data: { endedAt: new Date(), endReason: 'aborted' },
        });
      }
      return tx.stream.create({
        data: {
          userId: data.userId,
          songId: data.songId,
          ipAddress: data.ipAddress,
          userAgent: data.userAgent,
          deviceFingerprintId: data.deviceFingerprintId,
        },
      });
    });
  },
  async findById(id: string) {
    return prisma.stream.findUnique({
      where: { id },
      include: { ticks: { orderBy: { monotonicMs: 'asc' } } },
    });
  },
  async recordTick(streamId: string, data: {
    monotonicMs: number;
    positionSec: number;
    wasPause?: boolean;
    wasSeek?: boolean;
    seekFromSec?: number;
    seekToSec?: number;
    wasMuted?: boolean;
    wasHidden?: boolean;
    wasLooped?: boolean;
    audioElementVolume?: number;
  }) {
    return prisma.playbackTick.create({
      data: { streamId, ...data, monotonicMs: BigInt(data.monotonicMs) },
    });
  },
  async endStream(streamId: string, reason: 'natural' | 'skipped' | 'aborted' | 'flagged' | 'fraud') {
    return prisma.stream.update({
      where: { id: streamId },
      data: { endedAt: new Date(), endReason: reason },
    });
  },
  async markCharged(streamId: string) {
    return prisma.stream.update({
      where: { id: streamId },
      data: { charged: true, chargedAt: new Date() },
    });
  },
  async listRecentForUser(userId: string, take = 20) {
    return prisma.stream.findMany({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      take,
      include: { song: { select: { title: true, slug: true, coverUrl: true } } },
    });
  },
};