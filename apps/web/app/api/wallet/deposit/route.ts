/**
 * GET /api/wallet/deposit
 * Returns the deposit address + QR (as data URL) + chain metadata.
 */
import { withApi, prisma, requireSession } from '@pazzera/core';
import { getEnv } from '@pazzera/core';
import QRCode from 'qrcode';

export const GET = withApi(async () => {
  const session = await requireSession();
  const wallet = await prisma.wallet.findUnique({ where: { userId: session.userId } });
  if (!wallet) {
    return new Response(
      JSON.stringify({ ok: false, status: 'pending_provisioning' }),
      { status: 202, headers: { 'content-type': 'application/json' } },
    );
  }
  const env = getEnv();
  // Build a plain-text QR for "ethereum:<address>" (compatible with most wallets).
  const qrDataUrl = await QRCode.toDataURL(`ethereum:${wallet.address}@${env.ARC_CHAIN_ID}?token=${env.USDC_CONTRACT_ADDRESS}`, {
    margin: 1,
    color: { dark: '#9be15d', light: '#0a0a0a' },
    width: 320,
  });
  return new Response(
    JSON.stringify({
      ok: true,
      address: wallet.address,
      chain: { id: env.ARC_CHAIN_ID, explorer: env.ARC_EXPLORER_URL, rpc: env.ARC_RPC_URL },
      token: { symbol: 'USDC', address: env.USDC_CONTRACT_ADDRESS, decimals: env.USDC_DECIMALS },
      qrDataUrl,
      // Testnet-specific helpers
      faucet: {
        url: 'https://faucet.circle.com',
        notes: [
          '1. Open https://faucet.circle.com',
          '2. Select the Arc testnet network',
          '3. Paste your deposit address above',
          '4. Request USDC — it usually arrives in <30 seconds',
        ],
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
});