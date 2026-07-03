/**
 * Cross-process realtime event bridge.
 *
 * The Socket.IO server lives in the web process (Next.js custom
 * server), but payment events originate in the BullMQ worker process
 * (fan worker sign-and-settle, split worker fanout). In the worker,
 * the module-level `io` is null, so a direct `io.emit()` is
 * impossible — events must cross process boundaries through Redis.
 *
 * Worker side:  publishRealtimeEvent(room, event, payload)
 *               → PUBLISH pazzera:realtime:events {room, event, payload}
 * Web side:     startRealtimeEventBridge(io) subscribes on a dedicated
 *               connection and relays each message to the local room.
 *
 * Both sides use the existing REDIS_URL. Publishing is fire-and-forget:
 * if no web process is subscribed the message is dropped, which matches
 * the semantics of emitting to an empty room.
 */
import Redis from 'ioredis';
import { getEnv } from '@pazzera/core/config/env';
import { logger } from '@pazzera/core';

export const REALTIME_EVENTS_CHANNEL = 'pazzera:realtime:events';

interface BridgeMessage {
  room: string;
  event: string;
  payload: unknown;
}

let pubClient: Redis | null = null;
let subClient: Redis | null = null;

function getPubClient(): Redis {
  if (!pubClient) {
    pubClient = new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: 2 });
    pubClient.on('error', (e) => logger.error({ err: e }, 'realtime:bridge_pub_redis_error'));
  }
  return pubClient;
}

/**
 * Publish a realtime event from a process that does not host the
 * Socket.IO server (e.g. the BullMQ worker). Fire-and-forget; a
 * publish failure is logged but never throws into the payment path.
 */
export async function publishRealtimeEvent(
  room: string,
  event: string,
  payload: unknown,
): Promise<void> {
  const message: BridgeMessage = { room, event, payload };
  try {
    await getPubClient().publish(REALTIME_EVENTS_CHANNEL, JSON.stringify(message));
  } catch (err) {
    logger.warn({ err, room, event }, 'realtime:bridge_publish_failed');
  }
}

/**
 * Subscribe to bridged events and relay them into local Socket.IO
 * rooms. Called once by startRealtimeServer in the web process.
 * ioredis requires a dedicated connection for subscribe mode.
 */
export function startRealtimeEventBridge(io: {
  of(nsp: string): { to(room: string): { emit(event: string, payload: unknown): unknown } };
}): void {
  if (subClient) return; // already started
  subClient = new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: 2 });
  subClient.on('error', (e) => logger.error({ err: e }, 'realtime:bridge_sub_redis_error'));
  subClient.subscribe(REALTIME_EVENTS_CHANNEL, (err) => {
    if (err) {
      logger.error({ err }, 'realtime:bridge_subscribe_failed');
    } else {
      logger.info({ channel: REALTIME_EVENTS_CHANNEL }, 'realtime:bridge_ready');
    }
  });
  subClient.on('message', (channel, raw) => {
    if (channel !== REALTIME_EVENTS_CHANNEL) return;
    try {
      const msg = JSON.parse(raw) as BridgeMessage;
      if (!msg || typeof msg.room !== 'string' || typeof msg.event !== 'string') return;
      io.of('/').to(msg.room).emit(msg.event, msg.payload);
    } catch (err) {
      logger.warn({ err }, 'realtime:bridge_relay_failed');
    }
  });
}

/** Test helper — reset module state and drop connections. */
export async function __resetEventBridgeForTests(): Promise<void> {
  const clients = [pubClient, subClient].filter((c): c is Redis => c !== null);
  pubClient = null;
  subClient = null;
  await Promise.allSettled(clients.map((c) => c.quit()));
}
