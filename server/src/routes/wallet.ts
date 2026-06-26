import { Router } from 'express';
import { fundWalletFromFaucet } from '../services/circle.js';

export const walletRouter = Router();

// POST /api/wallet/fund — request faucet funding (one-tap for new fans)
walletRouter.post('/fund', async (req, res) => {
  const { address } = req.body ?? {};
  if (!address) return res.status(400).json({ error: 'address required' });
  const funded = await fundWalletFromFaucet(address);
  res.json({ address, fundedUsdc: funded });
});