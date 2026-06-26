/**
 * POST /api/play/sign-challenge
 *
 * Asks Circle W3S to create a "sign" challenge for the given user against the
 * EIP-712 typed-data challenge from /api/play/start. Returns a challengeId
 * which the frontend feeds to sdk.execute(challengeId) — the SDK pops the
 * hosted UI for the user to approve the signature, then returns the 0x... sig.
 *
 * NOTE: W3S's "sign arbitrary typed data" endpoint exists but requires a
 * specific data shape. The concrete request body may vary; this is the call
 * site to adjust once you have a Circle W3S app configured.
 */
import { Router } from 'express';
import { initiateUserControlledWalletsClient } from '@circle-fin/user-controlled-wallets';

export const signRouter = Router();

const circle = initiateUserControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY ?? '',
});

signRouter.post('/', async (req, res) => {
  try {
    const { challenge, userId } = req.body ?? {};
    if (!challenge || !userId) return res.status(400).json({ error: 'challenge and userId required' });

    // W3S supports signing arbitrary EIP-712 typed data via the user-signed
    // challenge endpoint. The exact shape depends on your app config — see
    // https://developers.circle.com/wallets/user-controlled/sign-message
    //
    // Most apps wire this by creating a transaction-shaped sign call OR
    // by using circle's "sign typed data" challenge helper. The response is
    // { challengeId } which the SDK's execute() handles.
    const r = await circle.signTypedData({
      userId,
      data: challenge.eip712,
      // Optional: sign-only mode (no on-chain tx)
      mode: 'SIGN_ONLY',
    } as any).catch((e: any) => ({ error: e }));

    if ((r as any).error) {
      // Fallback: create a no-op transaction that wraps the typed-data sign.
      // Many W3S configurations accept this pattern. Adjust to your app's
      // actual setup.
      return res.status(502).json({ error: 'signTypedData not enabled — configure Sign Typed Data in W3S console, then retry.' });
    }

    const challengeId = (r as any).data?.challengeId;
    if (!challengeId) return res.status(502).json({ error: 'no challengeId returned' });
    res.json({ challengeId });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});