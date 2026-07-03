/**
 * Realtime package — Socket.IO server + event schemas.
 */
export * from './events';
export * from './protocol';
export * from './server';
export {
  getState,
  startStream,
  ingestTick,
  endStream,
  recordSeek,
  recordLoop,
  snapshotAdminCounters,
  markSocketDisconnect,
  activeStreamCount,
  adminCounters,
  type StreamState,
} from './stream-aggregator';
export * from './nonce-store';
export * from './event-log';
export * from './event-bridge';
export * as legacySession from './session';
