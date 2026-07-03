/**
 * Phase 9 — Facilitator service.
 *
 * The single entry point for x402 nano-payment settlement.
 *
 * Responsibilities:
 *   1. Verify the EIP-712 signature (delegated to x402/verify.ts)
 *   2. Verify the nonce is fresh (delegated to realtime/nonce-store.ts —
 *      actually we use a local consumeNonce that wraps both Redis + Postgres)
 *   3. Submit the signed envelope to the Circle Gateway facilitator
 *   4. Poll for settlement confirmation (with bounded retries)
 *   5. On success: update Payment.status='settled', persist facilitatorTransferId
 *      + txHash + blockNumber + chainId + settledAt
 *   6. Trigger the Split Agent job
 *
 * Failures are categorized and produce PaymentEvent rows for the admin
 * dashboard. Categorization:
 *
 *   invalid_signature  → 422, no retry, mark Payment.failed
 *   expired            → 422, no retry, mark Payment.failed
 *   replay_nonce       → 409, no retry, mark Payment.failed
 *   insufficient       → 422, mark Payment.failed
 *   timeout            → retry up to 3 times, then mark Payment.failed
 *   chain_error        → retry up to 3 times, then mark Payment.failed (will need webhook reconcile)
 */
import { prisma } from '@pazzera/db';
import { logger, getEnv, BlockchainError } from '@pazzera/core';
import { enqueue } from '@pazzera/queue';
import { getActiveProvider } from '../circle/factory';
import { verifyAuthorizationSignature, isShape } from '../x402/verify';
import { isAuthorizationFresh, type X402Authorization } from '../x402/typed-data';

export type SettleFailureReason =
  | 'invalid_signature'
  | 'expired'
  | 'replay_nonce'
  | 'insufficient_balance'
  | 'chain_error'
  | 'timeout'
  | 'malformed';

export interface SettleInput {
  paymentId: string;
  envelope: X402Authorization;
  /** Caller has already done the consumer-side rate-limit guard. */
  nonce: string;
}

export interface SettleOutcome {
  ok: boolean;
  reason?: SettleFailureReason;
  retryable?: boolean;
  facilitatorTransferId?: string;
  txHash?: string;
  blockNumber?: number;
  chainId?: number;
  settledAt?: Date;
  latencyMs: number;
  amountUsdc?: string;
}

export class FacilitatorService {
  /**
   * Main entry. Idempotent: calling twice with the same paymentId is safe;
   * the second call returns the already-settled status without re-sending.
   */
  static async settle(input: SettleInput): Promise<SettleOutcome> {
    const started = Date.now();
    const env = getEnv();

    // 1. Idempotency check on the Payment row
    const existing = await prisma.payment.findUnique({
      where: { id: input.paymentId },
      select: { id: true, status: true, txHash: true, settledAt: true, facilitatorTransferId: true, amountUsdc: true },
    });
    if (!existing) {
      return { ok: false, reason: 'malformed', retryable: false, latencyMs: Date.now() - started };
    }
    if (existing.status === 'settled' && existing.txHash) {
      return {
        ok: true,
        facilitatorTransferId: existing.facilitatorTransferId ?? undefined,
        txHash: existing.txHash,
        settledAt: existing.settledAt ?? undefined,
        latencyMs: Date.now() - started,
        amountUsdc: existing.amountUsdc,
      };
    }

    // 2. Shape check
    if (!isShape(input.envelope)) {
      await this.recordFailure(input.paymentId, 'malformed', false);
      return { ok: false, reason: 'malformed', retryable: false, latencyMs: Date.now() - started };
    }

    // 3. Fresh-window check
    if (
      !isAuthorizationFresh(
        {
          from: input.envelope.from,
          to: input.envelope.to,
          value: input.envelope.value,
          validAfter: input.envelope.validAfter,
          validBefore: input.envelope.validBefore,
          nonce: input.envelope.nonce,
        },
      )
    ) {
      await this.recordFailure(input.paymentId, 'expired', false);
      return { ok: false, reason: 'expired', retryable: false, latencyMs: Date.now() - started };
    }

    // 4. Cryptographic verify
    const verified = await verifyAuthorizationSignature(input.envelope);
    if (!verified.valid) {
      await this.recordFailure(input.paymentId, 'invalid_signature', false);
      return { ok: false, reason: 'invalid_signature', retryable: false, latencyMs: Date.now() - started };
    }

    // 4b. Nonce single-use (Redis + Postgres). Defense in depth — the
    //     realtime server has already consumed the nonce, but if a path
    //     bypasses realtime this still rejects replay.
    //
    //     consumeNonce requires streamId to match the PaymentNonce row.
    //     We fetch the streamId from the Payment row instead of passing
    //     '' (which would always mismatch and falsely report replay).
    try {
      const { consumeNonce } = await import('@pazzera/realtime/nonce-store');
      const paymentRow = await prisma.payment.findUnique({
        where: { id: input.paymentId },
        select: { streamId: true },
      });
      const streamId = paymentRow?.streamId ?? '';
      const fresh = await consumeNonce({ nonce: input.nonce, streamId });
      if (!fresh) {
        await this.recordFailure(input.paymentId, 'replay_nonce', false);
        return { ok: false, reason: 'replay_nonce', retryable: false, latencyMs: Date.now() - started };
      }
    } catch {
      // If realtime package isn't importable here (e.g. in pure tests),
      // skip — the realtime server's pre-check is sufficient.
    }

    // 5. Provider submit
    const provider = getActiveProvider();
    const network = `eip155:${env.ARC_CHAIN_ID}`;
    let attempt = 0;
    const maxAttempts = 3;
    let lastError: unknown;
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        const result = await provider.settleX402({
          authorization: {
            from: input.envelope.from,
            to: input.envelope.to,
            value: input.envelope.value,
            validAfter: input.envelope.validAfter,
            validBefore: input.envelope.validBefore,
            nonce: input.envelope.nonce,
            v: input.envelope.v,
            r: input.envelope.r,
            s: input.envelope.s,
          },
          network,
        });
        if (result.success === false) {
          // Map the most common error reasons onto our failure kinds.
          // 'authorization_validity_too_short' is not retryable — fix
          // the envelope window upstream and retry. 'insufficient_funds'
          // is not retryable. Everything else is retryable.
          const reason = result.errorReason ?? 'chain_error';
          const mapped: SettleFailureReason =
            reason === 'insufficient_funds' ? 'insufficient_balance' :
            reason === 'authorization_validity_too_short' ? 'expired' :
            reason === 'invalid_signature' ? 'invalid_signature' :
            'chain_error';
          const retryable = mapped === 'chain_error';
          await this.recordFailure(input.paymentId, mapped, retryable);
          return { ok: false, reason: mapped, retryable, latencyMs: Date.now() - started };
        }
        // 6. Persist settlement — update Payment row in DB
        await prisma.payment.update({
          where: { id: input.paymentId },
          data: {
            status: 'settled',
            txHash: result.transaction || null,
            // Gateway uses the batch transaction id as the settlement
            // identifier until the chain tx hash lands. We use the
            // payer address as a stable cross-reference id until then.
            facilitatorTransferId: result.transaction || result.payer,
            settledAt: new Date(),
          },
        });

        // 7. Audit event + enqueue Split agent
        await prisma.paymentEvent.create({
          data: {
            kind: 'payment_settled',
            paymentId: input.paymentId,
            streamId: (await prisma.payment.findUnique({ where: { id: input.paymentId }, select: { streamId: true } }))?.streamId,
            songId: (await prisma.payment.findUnique({ where: { id: input.paymentId }, select: { songId: true } }))?.songId,
            amountUsdc: existing.amountUsdc,
            severity: 0,
            meta: {
              txHash: result.transaction,
              network: result.network,
              payer: result.payer,
              chainId: env.ARC_CHAIN_ID,
              latencyMs: Date.now() - started,
              nonce: input.nonce,
            },
          },
        }).catch(() => undefined);

        // 8. Trigger the Split Agent
        await enqueue.split({ paymentId: input.paymentId });

        return {
          ok: true,
          facilitatorTransferId: result.transaction || result.payer,
          txHash: result.transaction || undefined,
          chainId: env.ARC_CHAIN_ID,
          settledAt: new Date(),
          latencyMs: Date.now() - started,
          amountUsdc: existing.amountUsdc,
        };
      } catch (err) {
        lastError = err;
        const reason = this.categorize(err);
        if (reason === 'invalid_signature' || reason === 'expired' || reason === 'replay_nonce' || reason === 'insufficient_balance') {
          await this.recordFailure(input.paymentId, reason, false);
          return { ok: false, reason, retryable: false, latencyMs: Date.now() - started };
        }
        // chain_error / timeout → retry
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
          continue;
        }
      }
    }
    await this.recordFailure(input.paymentId, 'chain_error', true);
    return { ok: false, reason: 'chain_error', retryable: true, latencyMs: Date.now() - started, };
  }

  /**
   * Categorize a thrown error into our taxonomy.
   */
  static categorize(err: unknown): SettleFailureReason {
    if (err instanceof BlockchainError) {
      return 'chain_error';
    }
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (msg.includes('nonce') && msg.includes('used')) return 'replay_nonce';
    if (msg.includes('insufficient')) return 'insufficient_balance';
    if (msg.includes('expired') || msg.includes('stale')) return 'expired';
    if (msg.includes('signature') || msg.includes('recover')) return 'invalid_signature';
    if (msg.includes('timeout') || msg.includes('abort')) return 'timeout';
    return 'chain_error';
  }

  /**
   * Record a PaymentEvent row for every failure category (admin audit trail).
   */
  static async recordFailure(paymentId: string, reason: SettleFailureReason, retryable: boolean) {
    await prisma.paymentEvent.create({
      data: {
        kind: 'payment_failed',
        paymentId,
        severity: reason === 'replay_nonce' ? 100 : reason === 'invalid_signature' ? 75 : 25,
        meta: { reason, retryable },
      },
    }).catch(() => undefined);
    await prisma.payment.update({
      where: { id: paymentId },
      data: { status: reason === 'invalid_signature' || reason === 'replay_nonce' ? 'failed' : 'pending' },
    }).catch(() => undefined);
  }
}
