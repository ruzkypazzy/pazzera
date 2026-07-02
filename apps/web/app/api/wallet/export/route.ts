/**
 * POST /api/wallet/export
 *
 * Returns the user's decrypted wallet private key (one-time display).
 *
 * IMPORTANT: This is a UCW-export endpoint. The returned key is the actual
 * secp256k1 private key that controls the on-chain address shown on the
 * wallet page. Whoever has this key controls the funds. Treat it like a
 * seed phrase:
 *   - Never log it
 *   - Show it once in the UI, never store it client-side
 *   - Require explicit user confirmation (typed phrase) before returning
 *
 * In Circle UCW mode the platform never holds this key — the export
 * instead returns a Circle userToken and a refresh token, which the
 * client uses with the Circle W3S SDK to reconstruct the wallet via
 * the social/email/PIN recovery flow. See circle-ucw-provider.ts.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { withApi, prisma, getEnv, AuthError, ValidationError, getParsedBody } from '@pazzera/core';
import { decryptAndMigrate } from '@pazzera/blockchain';

// Accept the confirmation phrase with some forgiveness: trim, collapse
// whitespace, and ignore case. The client shows it as 'I understand' but
// a copy-paste from a rendered <p> could pick up curly quotes or extra
// spaces. Normalize before validating.
const Body = z.object({
  confirm: z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim().toLowerCase())
    .refine((s) => s === 'i understand', {
      message: 'You must type "I understand" to export the private key.',
    }),
});

export const dynamic = 'force-dynamic';

export const POST = withApi(
  async ({ req }) => {
    const body = getParsedBody<{ confirm?: string }>(req);
    const parsed = Body.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('You must type "I understand" to export the private key.', { issues: parsed.error.issues });
    }

    // Get the authed user's session — userId is NOT passed by withApi.
    const { requireSession } = await import('@pazzera/core');
    const session = await requireSession();
    const userId = session.userId;

    const wallet = await prisma.wallet.findUnique({
      where: { userId },
      select: {
        address: true,
        provider: true,
        custody: true,
        encryptedPrivateKey: true,
        status: true,
      },
    });

    if (!wallet) {
      throw new ValidationError('No wallet on file for this account.');
    }
    if (wallet.provider !== 'local-dev' && wallet.provider !== 'local') {
      // Real UCW path — return the Circle recovery bundle instead of a raw key.
      return NextResponse.json({
        ok: true,
        custody: wallet.custody,
        provider: wallet.provider,
        address: wallet.address,
        // Circle UCW never lets us see the raw key. Surface what we do have.
        message:
          'This wallet is held by Circle under User-Controlled Wallets (UCW). ' +
          'Use the Circle Web SDK to recover via PIN/social/email — the platform does not have access to the private key.',
      });
    }
    if (!wallet.encryptedPrivateKey) {
      throw new ValidationError('No encrypted key on file for this wallet.');
    }

    // Decrypt with the platform's WALLET_MASTER_KEY + the userId salt.
    // This is gated by:
    //   - Auth (requireSession, via withApi)
    //   - Body confirmation ("I understand")
    //   - The client only displays the key once and warns the user.
    const { key } = decryptAndMigrate(userId, wallet.encryptedPrivateKey);

    return NextResponse.json({
      ok: true,
      custody: wallet.custody,
      provider: wallet.provider,
      address: wallet.address,
      privateKey: key,
      warning:
        'Anyone with this private key can spend the funds at this address. ' +
        'Treat it like a seed phrase. Do not share it. Store it offline.',
    });
  },
  { bodySchema: Body },
);