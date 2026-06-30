/**
 * AI Agents package.
 *
 * Pure decision functions are in `./curator/decide`, `./fan/decide`,
 * `./split/decide`, `./discovery/decide`. Workers in `./workers/*`.
 *
 * The light-weight utils (`drift-counters`) are re-exported here; the
 * heavier ones (`agent-health`, `record-decision`) are intentionally
 * NOT re-exported from this barrel to keep the import graph slim for
 * web/server callers — import them directly when needed.
 */
export * from './curator/decide';
export * from './fan/decide';
export * from './split/decide';
export * from './discovery/decide';
export * from './workers/wallet-reconcile-worker';
export { driftCounters, resetDriftCounters } from './utils/drift-counters';
export { toJsonValue, toJsonValueOrUnset } from '@pazzera/db/utils/json-cast';
