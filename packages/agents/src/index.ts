/**
 * AI Agents package.
 *
 * Each agent has:
 *   1. A pure decision function (no I/O, easy to test)
 *   2. A job handler (loads context, calls decision function, persists result)
 *
 * Workers live in `./workers/*`. The actual Fan/Split/Curator decision
 * functions live in `./curator`, `./fan`, `./split` respectively.
 */
export * from './curator/decide';
export * from './fan/decide';
export * from './split/decide';
export * from './workers/curator-worker';
export * from './workers/fan-worker';
export * from './workers/split-worker';