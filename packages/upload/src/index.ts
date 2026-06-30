/**
 * Pazzera upload pipeline.
 *
 * Modules:
 *   - validation:    MIME + size + filename rules
 *   - metadata:      ffprobe wrapper, LUFS extraction
 *   - fingerprint:   SHA-256 binary hash + acoustic fingerprint (chromaprint-style)
 *   - waveform:      peak extraction (audiowaveform-compatible JSON)
 *   - preview:       30s clip generation
 *   - cover:         resize + thumbnail/medium variants
 *   - nsfw:          stub NSFW check
 *   - pipeline:      state machine + finalizer
 *
 * All processing jobs are enqueued on BullMQ and run by workers in
 * `apps/agents/src/workers/*` so the same worker process handles
 * upload processing + agent decisions.
 */
export * from './validation';
export * from './metadata';
export * from './fingerprint';
export * from './waveform';
export * from './preview';
export * from './cover';
export * from './nsfw';
export * from './pipeline';