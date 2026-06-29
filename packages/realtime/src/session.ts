/**
 * Stream session manager.
 *
 * Server-authoritative playback state. The browser is treated as a thin
 * reporter; the server tracks monotonic ticks and decides when to charge.
 */
import { createHash } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { getEnv, logger } from '@pazzera/core';
import { prisma } from '@pazzera/db';

interface StreamState {
  streamId: string;
  userId: string;
  songId: string;
  durationSec: number;
  thresholdSec: number;
  startedAtMs: number;
  lastTickAtMs: number;
  lastTickPositionSec: number;
  charged: boolean;
  /** Total > 30s seeks in the last 10s window. */
  recentSeekCount: number;
  paused: boolean;
  totalActiveMs: number;
}

const states = new Map<string, StreamState>();
const userActiveStream = new Map<string, string>();

function ticketFor(streamId: string, userId: string): string {
  const env = getEnv();
  return createHash('sha256')
    .update(env.COOKIE_SECRET)
    .update(streamId)
    .update(userId)
    .digest('hex')
    .slice(0, 32);
}

export function issueTicket(streamId: string, userId: string): string {
  return ticketFor(streamId, userId);
}

export function verifyTicket(
  streamId: string,
  userId: string,
  ticket: string,
): boolean {
  return ticketFor(streamId, userId) === ticket;
}

export async function loadStreamState(
  streamId: string,
): Promise<StreamState | null> {
  const cached = states.get(streamId);
  if (cached) return cached;

  const stream = await prisma.stream.findUnique({
    where: { id: streamId },
    select: {
      id: true,
      userId: true,
      songId: true,
      song: { select: { durationSeconds: true } },
      startedAt: true,
      charged: true,
    },
  });
  if (!stream) return null;

  const env = getEnv();
  const thresholdSec = Math.max(
    1,
    Math.floor(
      (stream.song.durationSeconds * env.FAN_AGENT_DURATION_THRESHOLD_PCT) / 100,
    ),
  );

  const state: StreamState = {
    streamId: stream.id,
    userId: stream.userId,
    songId: stream.songId,
    durationSec: stream.song.durationSeconds,
    thresholdSec,
    startedAtMs: stream.startedAt.getTime(),
    lastTickAtMs: Date.now(),
    lastTickPositionSec: 0,
    charged: stream.charged,
    recentSeekCount: 0,
    paused: false,
    totalActiveMs: 0,
  };
  states.set(streamId, state);
  userActiveStream.set(stream.userId, streamId);
  return state;
}

export function setState(streamId: string, patch: Partial<StreamState>): void {
  const cur = states.get(streamId);
  if (!cur) return;
  states.set(streamId, { ...cur, ...patch });
}

export function getState(streamId: string): StreamState | undefined {
  return states.get(streamId);
}

export function clearState(streamId: string): void {
  const s = states.get(streamId);
  if (s) userActiveStream.delete(s.userId);
  states.delete(streamId);
}

export function getUserActiveStream(userId: string): string | undefined {
  return userActiveStream.get(userId);
}

export type { StreamState };
export type SocketType = Socket;
export type ServerType = Server;