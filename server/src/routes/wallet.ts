import { Router } from 'express';
import { requestFaucetFunding } from '../services/circle.js';

export const walletRouter = Router();

// POST /api/wallet/fund — request testnet USDC for the given address.
// Real faucet call is a no-op (the Canteen/Circle faucet is human-gated);
// we just log so the developer can fund manually at faucet.circle.com.
walletRouter.post('/fund', async (req, res) => {
  const { address } = req.body ?? {};
  if (!address) return res.status(400).json({ error: 'address required' });
  await requestFaucetFunding(address);
  res.json({
    address,
    funded: true,
    faucetUrl: process.env.FAUCET_URL ?? 'https://faucet.circle.com',
    note: 'Visit the faucet URL to request testnet USDC for this address.',
  });
});