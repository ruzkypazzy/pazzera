/**
 * AuthEvent logging + AuthRiskScore aggregation.
 *
 * Every auth-related event (OTP request, verify, failed attempt, session
 * revoke) writes one AuthEvent row. Risk scores are derived per (email, ip)
 * on read — keeping the write path simple and avoiding hot-row contention.
 */
import { prisma } from '@pazzera/db';
import { logger } from '../utils/logger';

export interface AuthEventInput {
  type: string;
  userId?: string | null;
  email?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
  severity?: number;
  meta?: Record<string, unknown>;
}

export async function recordAuthEvent(input: AuthEventInput): Promise<void> {
  try {
    await prisma.authEvent.create({
      data: {
        type: input.type,
        userId: input.userId ?? null,
        email: input.email ?? null,
        ipHash: input.ipHash ?? null,
        userAgent: input.userAgent ?? null,
        severity: input.severity ?? 0,
        meta: (input.meta ?? null) as object | null,
      },
    });
  } catch (err) {
    logger.error({ err, type: input.type }, 'auth_event:write_failed');
  }
}

export interface RiskScore {
  emailScore: number;
  ipScore: number;
  total: number;
  cooldownSeconds: number;
}

/**
 * Compute the current AuthRiskScore for the given email + ipHash.
 * Returns 0–100. If total > 60, the caller should apply a cooldown
 * before issuing another OTP.
 */
export async function computeAuthRiskScore(
  email: string,
  ipHash: string | null,
): Promise<RiskScore> {
  const now = Date.now();
  const oneHourAgo = new Date(now - 60 * 60 * 1000);

  // Sum severity in the last hour by key
  const [emailEvents, ipEvents] = await Promise.all([
    prisma.authEvent.findMany({
      where: { email, createdAt: { gte: oneHourAgo } },
      select: { severity: true, type: true, createdAt: true },
    }),
    ipHash
      ? prisma.authEvent.findMany({
          where: { ipHash, createdAt: { gte: oneHourAgo } },
          select: { severity: true, type: true, createdAt: true },
        })
      : Promise.resolve([] as { severity: number; type: string; createdAt: Date }[]),
  ]);

  const sum = (rows: { severity: number }[]) => rows.reduce((s, r) => s + r.severity, 0);
  const emailScore = Math.min(100, sum(emailEvents));
  const ipScore = Math.min(100, sum(ipEvents));
  const total = Math.min(100, Math.max(emailScore, ipScore / 2 + emailScore / 2));

  // Cooldown proportional to risk
  let cooldownSeconds = 0;
  if (total > 80) cooldownSeconds = 60 * 30; // 30 min
  else if (total > 60) cooldownSeconds = 60 * 5; // 5 min
  else if (total > 40) cooldownSeconds = 60; // 1 min

  return { emailScore, ipScore, total, cooldownSeconds };
}

// ─── Disposable email domain blocklist ───────────────────────────────
// A small curated list — for production use a maintained list like
// https://github.com/disposable-email-domains/disposable-email-domains
const DISPOSABLE_DOMAINS = new Set<string>([
  'mailinator.com',
  'guerrillamail.com',
  '10minutemail.com',
  'tempmail.com',
  'trashmail.com',
  'yopmail.com',
  'dispostable.com',
  'fakeinbox.com',
  'getnada.com',
  'maildrop.cc',
  'sharklasers.com',
  'spam4.me',
  'throwawaymail.com',
]);

export function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  return DISPOSABLE_DOMAINS.has(domain);
}