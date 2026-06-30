/**
 * Phase 9 — Circle provider factory.
 *
 * Selection:
 *   - If CIRCLE_API_KEY is set + env is prod/test → real
 *   - Else → mock (deterministic, no network)
 *
 * Override via `PAZZERA_CIRCLE=mock|real` for explicit testing.
 */
import { getEnv } from '@pazzera/core';
import type { CircleProvider } from './provider';
import { CircleMockProvider, mockCircleProvider } from './mock-provider';
import { CircleRealProvider } from './real-provider';

let cached: CircleProvider | null = null;

export function getActiveProvider(): CircleProvider {
  if (cached) return cached;
  const env = getEnv();
  const override = process.env.PAZZERA_CIRCLE;
  if (override === 'mock') {
    cached = mockCircleProvider;
    return cached;
  }
  if (env.CIRCLE_API_KEY && override !== 'never-real') {
    cached = new CircleRealProvider();
    return cached;
  }
  cached = mockCircleProvider;
  return cached;
}

export function setActiveProvider(p: CircleProvider | null): void {
  cached = p;
}

export { CircleMockProvider, mockCircleProvider, CircleRealProvider };
