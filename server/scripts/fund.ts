/**
 * Self-fund a wallet with Arc testnet USDC via Circle's faucet.
 * Real wallets (real addresses) — no mocks.
 *
 *   npm run fund -- 0xYourWalletAddress
 *
 * The Canteen-hosted testnet faucet URL is exposed by `arc-canteen status`
 * after login. For development convenience, we also try Circle's canonical
 * faucet endpoint.
 */
const addr = process.argv[2];
if (!addr) {
  console.error('usage: npm run fund -- 0xWalletAddress');
  process.exit(1);
}

const endpoints = [
  process.env.FAUCET_URL,
  'https://faucet.circle.com',
  'https://faucet.testnet.arc.network',
].filter(Boolean) as string[];

(async () => {
  for (const url of endpoints) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: addr, chain: 'ARC-TESTNET' }),
      });
      console.log(`[fund] POST ${url} → ${r.status}`);
      if (r.ok) {
        console.log(`[fund] OK — ${addr} requested for Arc Testnet USDC`);
        return;
      }
    } catch (e) {
      console.log(`[fund] ${url} unreachable: ${(e as Error).message}`);
    }
  }
  console.log(`[fund] No automated faucet accepted the request. Visit https://faucet.circle.com and request USDC for ${addr} manually.`);
})();