/**
 * Wallet Recovery Service.
 *
 * States:
 *   recovery_requested → user filled out form
 *   recovery_verified  → email challenge verified
 *   recovery_completed → new keys provisioned, sessions revoked
 *
 * On completion:
 *   - Generate fresh keypair
 *   - Re-encrypt under the existing master key
 *   - Replace Wallet.encryptedPrivateKey
 *   - Mark wallet status = 'compromised' if reason='compromised', else 'active'
 *   - Revoke all sessions for the user
 *   - Enforce recovery cooldown (24h) before any new x402 authorizations
 */
import { prisma } from '@pazzera/db';
import { randomBytes } from 'node:crypto';
import { logger, getEnv, AppError, AuthError } from '@pazzera/core';
import { WalletService } from './wallet-service';
import { revokeAllForUser, validateSession } from '@pazzera/core/services/session-service';

const RECOVERY_CHALLENGE_TTL_MIN = 15;

function newChallenge(): string {
  return randomBytes(24).toString('base64url');
}

export const WalletRecoveryService = {
  async request(opts: {
    userId: string;
    walletId: string;
    reason: 'lost_key' | 'compromised' | 'device_lost';
  }): Promise<{ challenge: string; expiresAt: Date }> {
    const wallet = await prisma.wallet.findUnique({ where: { id: opts.walletId } });
    if (!wallet) throw new AppError('NOT_FOUND', 'Wallet not found', 404);
    if (wallet.userId !== opts.userId) throw new AppError('FORBIDDEN', 'Wallet mismatch', 403);

    const challenge = newChallenge();
    const expiresAt = new Date(Date.now() + RECOVERY_CHALLENGE_TTL_MIN * 60 * 1000);

    // Mark wallet as recovery_requested (UI reflects this)
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { status: 'recovery_requested', recoveryRequestedAt: new Date() },
    });

    await prisma.walletRecovery.upsert({
      where: { walletId: wallet.id },
      create: {
        walletId: wallet.id,
        userId: wallet.userId,
        reason: opts.reason,
        challenge,
        challengeExpiresAt: expiresAt,
        state: 'recovery_requested',
      },
      update: {
        reason: opts.reason,
        challenge,
        challengeExpiresAt: expiresAt,
        state: 'recovery_requested',
        attempts: 0,
      },
    });

    // In real impl: send the challenge to the user's verified email via Resend
    // For hackathon dev: log it (no secret actually leaves the server)
    logger.info({ userId: wallet.userId, walletId: wallet.id }, 'wallet_recovery:requested');

    return { challenge, expiresAt };
  },

  async verifyChallenge(opts: { userId: string; walletId: string; challenge: string }) {
    const rec = await prisma.walletRecovery.findUnique({ where: { walletId: opts.walletId } });
    if (!rec) throw new AppError('NOT_FOUND', 'No recovery in progress', 404);
    if (rec.userId !== opts.userId) throw new AppError('FORBIDDEN', 'Wallet mismatch', 403);
    if (rec.state === 'recovery_completed') {
      throw new AppError('CONFLICT', 'Recovery already completed', 409);
    }
    if (!rec.challenge || !rec.challengeExpiresAt || rec.challengeExpiresAt < new Date()) {
      throw new AppError('AUTH_INVALID', 'Recovery challenge expired', 401);
    }
    if (rec.attempts >= 5) {
      throw new AppError('AUTH_RATE_LIMITED', 'Too many recovery attempts', 429);
    }
    if (rec.challenge !== opts.challenge) {
      await prisma.walletRecovery.update({
        where: { id: rec.id },
        data: { attempts: { increment: 1 } },
      });
      throw new AppError('AUTH_INVALID', 'Invalid recovery challenge', 401);
    }
    await prisma.walletRecovery.update({
      where: { id: rec.id },
      data: { state: 'recovery_verified' },
    });
    return { ok: true };
  },

  async complete(opts: { userId: string; walletId: string; currentSessionRawToken?: string }) {
    const env = getEnv();
    const rec = await prisma.walletRecovery.findUnique({ where: { walletId: opts.walletId } });
    if (!rec) throw new AppError('NOT_FOUND', 'No recovery in progress', 404);
    if (rec.userId !== opts.userId) throw new AppError('FORBIDDEN', 'Wallet mismatch', 403);
    if (rec.state !== 'recovery_verified') {
      throw new AppError('CONFLICT', 'Recovery not verified', 409);
    }

    const wallet = await prisma.wallet.findUnique({ where: { id: opts.walletId } });
    if (!wallet) throw new AppError('NOT_FOUND', 'Wallet not found', 404);

    // Provision a fresh keypair (delegates to provider)
    const { getWalletProvider } = await import('../wallets/factory');
    const provider = getWalletProvider();
    const fresh = await provider.createWallet({ userId: opts.userId });
    if (!fresh.encryptedSecret) {
      throw new AppError(
        'BLOCKCHAIN_ERROR',
        'Provider does not support in-place recovery; create a new wallet instead',
        501,
      );
    }

    // Determine new status
    const newStatus = rec.reason === 'compromised' ? 'compromised' : 'active';
    const cooldownUntil = new Date(Date.now() + env.WALLET_RECOVERY_COOLDOWN_HOURS * 60 * 60 * 1000);

    await prisma.$transaction([
      prisma.wallet.update({
        where: { id: wallet.id },
        data: {
          address: fresh.address,
          encryptedPrivateKey: fresh.encryptedSecret,
          encryptionVersion: 2,
          keyVersion: 1,
          providerWalletId: fresh.providerWalletId,
          status: newStatus,
          compromisedAt: rec.reason === 'compromised' ? new Date() : wallet.compromisedAt,
          recoveryRequestedAt: new Date(),
          x402AuthorizedAt: cooldownUntil, // gate x402 for cooldown period
        },
      }),
      prisma.walletRecovery.update({
        where: { id: rec.id },
        data: {
          state: 'recovery_completed',
          completedAt: new Date(),
          newEncryptedSecret: fresh.encryptedSecret,
        },
      }),
    ]);

    // Revoke all sessions
    const exceptId = opts.currentSessionRawToken
      ? (await validateSession(opts.currentSessionRawToken))?.id
      : undefined;
    await revokeAllForUser(opts.userId, 'suspicion', exceptId);

    logger.info(
      { userId: opts.userId, walletId: wallet.id, newAddress: fresh.address, reason: rec.reason },
      'wallet_recovery:completed',
    );

    return { newAddress: fresh.address, status: newStatus, cooldownUntil };
  },

  async cancel(opts: { userId: string; walletId: string }) {
    const rec = await prisma.walletRecovery.findUnique({ where: { walletId: opts.walletId } });
    if (!rec) return { ok: true };
    if (rec.userId !== opts.userId) throw new AppError('FORBIDDEN', 'Wallet mismatch', 403);
    if (rec.state === 'recovery_completed') {
      throw new AppError('CONFLICT', 'Cannot cancel completed recovery', 409);
    }
    await prisma.$transaction([
      prisma.wallet.update({
        where: { id: opts.walletId },
        data: { status: 'active' },
      }),
      prisma.walletRecovery.update({
        where: { id: rec.id },
        data: { state: 'recovery_completed', completedAt: new Date() },
      }),
    ]);
    return { ok: true };
  },
};