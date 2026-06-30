/**
 * OTP service.
 *
 * Two-step flow:
 *   1. requestOtp(email, purpose) → generate 6-digit code, store Argon2id hash
 *      in DB, return plaintext code to caller (which sends it via email).
 *   2. verifyOtp(email, code) → hash input, look up most recent unconsumed
 *      unexpired OTP for (email, purpose), constant-time compare, mark consumed.
 *
 * Security:
 *   - Plaintext OTP is NEVER persisted; only the Argon2id hash lives in DB.
 *   - maxAttempts (default 5) enforced; on exceed, the code is invalidated.
 *   - Successful verification invalidates the code immediately.
 *   - Rate limits live in the route handler (Limiters.otpPerEmail / otpPerIp).
 */
import { prisma } from '@pazzera/db';
import { logger, getEnv, RateLimitError, ValidationError } from '../index';
import { hashOtp, verifyOtpHash } from '../utils/password-hash';
import { recordAuthEvent } from './auth-events';

const MAX_OTP_ATTEMPTS = 5;

function generateOtpCode(length = 6): string {
  const max = 10 ** length;
  const n = Math.floor(Math.random() * max);
  return n.toString().padStart(length, '0');
}

export type OtpPurpose = 'sign_in' | 'reset_password' | 'wallet_recovery' | 'artist_upgrade';

export interface RequestOtpInput {
  email: string;
  purpose?: OtpPurpose;
  ipHash?: string | null;
  userAgent?: string | null;
}

export interface RequestOtpResult {
  /** Plaintext code — caller MUST send via email and not log it. */
  code: string;
  expiresAt: Date;
}

export async function requestOtp(input: RequestOtpInput): Promise<RequestOtpResult> {
  const env = getEnv();
  const email = input.email.trim().toLowerCase();
  const purpose: OtpPurpose = input.purpose ?? 'sign_in';

  // Look up user (may not exist yet — that's fine, sign-in creates account on first verify)
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });

  // Invalidate any prior unconsumed OTPs for (email, purpose) to prevent code-stacking
  await prisma.otpCode.updateMany({
    where: { email, purpose, consumedAt: null, invalidated: false },
    data: { invalidated: true },
  });

  const code = generateOtpCode(env.OTP_LENGTH);
  const codeHash = await hashOtp(code);
  const expiresAt = new Date(Date.now() + env.OTP_TTL_SECONDS * 1000);

  await prisma.otpCode.create({
    data: {
      userId: user?.id,
      email,
      codeHash,
      expiresAt,
      purpose,
      maxAttempts: MAX_OTP_ATTEMPTS,
      requestIpHash: input.ipHash,
      requestUserAgent: input.userAgent,
    },
  });

  await recordAuthEvent({
    type: 'otp_requested',
    userId: user?.id,
    email,
    ipHash: input.ipHash,
    userAgent: input.userAgent,
  });

  logger.info({ email, purpose }, 'otp:requested');
  return { code, expiresAt };
}

export interface VerifyOtpInput {
  email: string;
  code: string;
  purpose?: OtpPurpose;
  ipHash?: string | null;
  userAgent?: string | null;
}

export interface VerifyOtpResult {
  ok: true;
  userId: string;
  isNewUser: boolean;
  otpId: string;
}

export type VerifyOtpFailure =
  | { ok: false; code: 'invalid_or_expired'; message: string }
  | { ok: false; code: 'too_many_attempts'; message: string };

export async function verifyOtp(
  input: VerifyOtpInput,
): Promise<VerifyOtpResult | VerifyOtpFailure> {
  const email = input.email.trim().toLowerCase();
  const purpose: OtpPurpose = input.purpose ?? 'sign_in';
  const code = input.code.trim();

  if (!/^\d{6}$/.test(code)) {
    await recordAuthEvent({
      type: 'otp_failed',
      email,
      ipHash: input.ipHash,
      userAgent: input.userAgent,
      severity: 5,
      meta: { reason: 'malformed_code', purpose },
    });
    return { ok: false, code: 'invalid_or_expired', message: 'Invalid or expired code' };
  }

  const otp = await prisma.otpCode.findFirst({
    where: {
      email,
      purpose,
      consumedAt: null,
      invalidated: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
    include: { user: true },
  });

  if (!otp) {
    await recordAuthEvent({
      type: 'otp_failed',
      email,
      ipHash: input.ipHash,
      userAgent: input.userAgent,
      severity: 10,
      meta: { reason: 'no_active_code', purpose },
    });
    return { ok: false, code: 'invalid_or_expired', message: 'Invalid or expired code' };
  }

  // Attempts cap
  if (otp.attemptsUsed >= otp.maxAttempts) {
    await prisma.otpCode.update({
      where: { id: otp.id },
      data: { invalidated: true },
    });
    await recordAuthEvent({
      type: 'otp_brute_force',
      email,
      userId: otp.userId ?? undefined,
      ipHash: input.ipHash,
      userAgent: input.userAgent,
      severity: 60,
      meta: { otpId: otp.id, purpose },
    });
    return {
      ok: false,
      code: 'too_many_attempts',
      message: 'Too many attempts. Request a new code.',
    };
  }

  // Verify (Argon2id constant-time)
  const matches = await verifyOtpHash(code, otp.codeHash);

  if (!matches) {
    // Increment attempts atomically
    const updated = await prisma.otpCode.update({
      where: { id: otp.id },
      data: { attemptsUsed: { increment: 1 } },
    });
    await recordAuthEvent({
      type: 'otp_failed',
      email,
      userId: otp.userId ?? undefined,
      ipHash: input.ipHash,
      userAgent: input.userAgent,
      severity: 15,
      meta: { otpId: otp.id, attemptsUsed: updated.attemptsUsed, purpose },
    });
    return { ok: false, code: 'invalid_or_expired', message: 'Invalid or expired code' };
  }

  // Success — mark consumed + invalidated
  await prisma.otpCode.update({
    where: { id: otp.id },
    data: { consumedAt: new Date(), invalidated: true },
  });

  // Resolve or create the User
  let userId: string;
  let isNewUser = false;
  if (otp.userId) {
    userId = otp.userId;
  } else {
    // Lazy-create the user
    const { generateUsernameFromEmail } = await import('../utils/username');
    const { UserRepo } = await import('@pazzera/db/repositories');
    let username = generateUsernameFromEmail(email);
    // Ensure uniqueness (max 5 attempts to dodge the random suffix collision)
    for (let i = 0; i < 5; i++) {
      const existing = await prisma.user.findUnique({ where: { username } });
      if (!existing) break;
      username = generateUsernameFromEmail(email);
    }
    const created = await UserRepo.create({ email, username });
    userId = created.id;
    isNewUser = true;
    await prisma.otpCode.update({
      where: { id: otp.id },
      data: { userId },
    });
  }

  await recordAuthEvent({
    type: 'otp_verified',
    userId,
    email,
    ipHash: input.ipHash,
    userAgent: input.userAgent,
    severity: 0,
    meta: { isNewUser, otpId: otp.id, purpose },
  });

  logger.info({ email, userId, isNewUser, purpose }, 'otp:verified');
  return { ok: true, userId, isNewUser, otpId: otp.id };
}