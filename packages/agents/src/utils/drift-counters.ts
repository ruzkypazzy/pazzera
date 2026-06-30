/**
 * Shared drift counters — exposed as a separate module so web/app code
 * can read the live state without importing the entire wallet:reconcile
 * worker (which depends on Prisma + BullMQ + the Circle provider).
 */
export const driftCounters = {
  lastRunAt: 0,
  driftDetected: 0,
  driftRepaired: 0,
  walletsChecked: 0,
};

export function resetDriftCounters(): void {
  driftCounters.lastRunAt = 0;
  driftCounters.driftDetected = 0;
  driftCounters.driftRepaired = 0;
  driftCounters.walletsChecked = 0;
}
