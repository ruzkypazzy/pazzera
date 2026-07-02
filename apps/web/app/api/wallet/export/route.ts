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

    // Pazzera now runs in DCW mode: Circle owns the key, Pazzera signs via
    // Circle APIs server-side. We never expose a raw private key to the
    // user. The "reveal" flow returns the custody model + a path forward
    // (Circle Web SDK for UCW, or a Circle-backed recovery bundle).
    if (wallet.provider !== 'local-dev' && wallet.provider !== 'local') {
      return NextResponse.json({
        ok: true,
        custody: wallet.custody,
        provider: wallet.provider,
        address: wallet.address,
        message:
          'This is a Circle-DCW (Developer-Controlled) wallet — Circle holds ' +
          'the key. To move funds out of Pazzera you must use the Circle Web ' +
          'SDK or contact support. Pazzera never has access to export the ' +
          'raw private key because Circle (the developer-controlled wallet ' +
          'provider) creates it on our behalf.',
      });
    }

    if (!wallet.encryptedPrivateKey) {
      throw new ValidationError('No encrypted key on file for this wallet.');
    }

    // Legacy local-dev path: Pazzera held the encrypted key. Kept for
    // backwards compat with any rows provisioned before the DCW switch.
    // New accounts go through the DCW branch above.
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