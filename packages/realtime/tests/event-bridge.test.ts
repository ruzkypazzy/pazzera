/**
 * Event-bridge tests — cross-process payment event relay.
 *
 * The fan/split workers run in a separate process from the Socket.IO
 * server, so their payment events must cross Redis pub/sub. These
 * tests mock ioredis and verify:
 *   - publishRealtimeEvent publishes a well-formed message
 *   - startRealtimeEventBridge relays messages into the right room
 *   - malformed messages are dropped without throwing
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const publishes: Array<{ channel: string; message: string }> = [];
let messageHandler: ((channel: string, raw: string) => void) | null = null;
let subscribedChannel: string | null = null;

vi.mock('ioredis', () => {
  class MockRedis {
    on() {
      return this;
    }
    async publish(channel: string, message: string) {
      publishes.push({ channel, message });
      return 1;
    }
    subscribe(channel: string, cb?: (err: Error | null) => void) {
      subscribedChannel = channel;
      cb?.(null);
      return Promise.resolve(1);
    }
    async quit() {
      return 'OK';
    }
  }
  // Intercept .on('message', …) registration
  MockRedis.prototype.on = function (event: string, handler: never) {
    if (event === 'message') messageHandler = handler;
    return this;
  } as never;
  return { default: MockRedis, Redis: MockRedis };
});

vi.mock('@pazzera/core/config/env', () => ({
  getEnv: () => ({ REDIS_URL: 'redis://mock:6379' }),
}));
vi.mock('@pazzera/core', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  publishRealtimeEvent,
  startRealtimeEventBridge,
  REALTIME_EVENTS_CHANNEL,
  __resetEventBridgeForTests,
} from '../src/event-bridge';

beforeEach(() => {
  publishes.length = 0;
  messageHandler = null;
  subscribedChannel = null;
});

afterEach(async () => {
  await __resetEventBridgeForTests();
});

describe('publishRealtimeEvent (worker side)', () => {
  it('publishes room + event + payload as JSON on the bridge channel', async () => {
    await publishRealtimeEvent('stream:abc', 'payment_settled', { txHash: '0x123' });
    expect(publishes).toHaveLength(1);
    expect(publishes[0]!.channel).toBe(REALTIME_EVENTS_CHANNEL);
    const msg = JSON.parse(publishes[0]!.message);
    expect(msg).toEqual({
      room: 'stream:abc',
      event: 'payment_settled',
      payload: { txHash: '0x123' },
    });
  });

  it('never throws into the payment path even if publish fails', async () => {
    // Force the mock to throw
    const bad = publishes.push.bind(publishes);
    publishes.push = () => {
      throw new Error('redis down');
    };
    await expect(
      publishRealtimeEvent('stream:x', 'payment_due', {}),
    ).resolves.toBeUndefined();
    publishes.push = bad;
  });
});

describe('startRealtimeEventBridge (web side)', () => {
  function mockIo() {
    const emitted: Array<{ room: string; event: string; payload: unknown }> = [];
    const io = {
      of: () => ({
        to: (room: string) => ({
          emit: (event: string, payload: unknown) => {
            emitted.push({ room, event, payload });
            return true;
          },
        }),
      }),
    };
    return { io, emitted };
  }

  it('subscribes to the bridge channel and relays messages to the room', () => {
    const { io, emitted } = mockIo();
    startRealtimeEventBridge(io);
    expect(subscribedChannel).toBe(REALTIME_EVENTS_CHANNEL);
    expect(messageHandler).not.toBeNull();

    messageHandler!(
      REALTIME_EVENTS_CHANNEL,
      JSON.stringify({ room: 'stream:s1', event: 'payment_due', payload: { amountUsdc: '0.003' } }),
    );
    expect(emitted).toEqual([
      { room: 'stream:s1', event: 'payment_due', payload: { amountUsdc: '0.003' } },
    ]);
  });

  it('drops malformed messages without throwing', () => {
    const { io, emitted } = mockIo();
    startRealtimeEventBridge(io);
    expect(() => messageHandler!(REALTIME_EVENTS_CHANNEL, 'not-json{')).not.toThrow();
    expect(() =>
      messageHandler!(REALTIME_EVENTS_CHANNEL, JSON.stringify({ nope: true })),
    ).not.toThrow();
    expect(emitted).toHaveLength(0);
  });

  it('ignores messages from other channels', () => {
    const { io, emitted } = mockIo();
    startRealtimeEventBridge(io);
    messageHandler!(
      'some:other:channel',
      JSON.stringify({ room: 'stream:s1', event: 'payment_due', payload: {} }),
    );
    expect(emitted).toHaveLength(0);
  });
});
