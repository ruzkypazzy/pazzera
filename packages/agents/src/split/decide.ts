/**
 * Split Agent — pure decision function.
 *
 * Supports BOTH internal Pazzera users (resolved via User.wallet.address)
 * and external wallet addresses (passed in directly on RoyaltyRecipient).
 *
 * Enforces:
 *   - sum(bps) === 10000
 *   - at least one recipient
 *   - deterministic ordering by payoutPriority (asc)
 *   - last recipient absorbs the remainder to ensure totalBaseUnits is exact
 */
export interface SplitRecipient {
  username: string;
  walletAddress: string | null; // null → externalWalletAddress was used
  externalAddress: string | null;
  recipientUserId: string | null;
  role: string;
  bps: number;
  payoutPriority: number;
}

export interface SplitInput {
  paymentId: string;
  amountUsdcBaseUnits: bigint;
  recipients: SplitRecipient[];
}

export interface SplitTransfer {
  recipientUserId: string | null;
  recipientUsername: string;
  recipientRole: string;
  recipientAddress: string; // resolved final address (internal or external)
  amountBaseUnits: bigint;
  payoutPriority: number;
}

export interface SplitOutput {
  transfers: SplitTransfer[];
  totalBaseUnits: bigint;
  remainderAbsorbedByUsername: string | null;
}

export function decideSplit(input: SplitInput): SplitOutput {
  if (input.recipients.length === 0) {
    throw new Error('No recipients configured');
  }
  const totalBps = input.recipients.reduce((s, r) => s + r.bps, 0);
  if (totalBps !== 10000) {
    throw new Error(`Recipient bps must sum to 10000, got ${totalBps}`);
  }

  // Validate every recipient has an address resolved
  for (const r of input.recipients) {
    const addr = r.walletAddress ?? r.externalAddress;
    if (!addr) {
      throw new Error(
        `Recipient ${r.username} has no resolved address (internal wallet missing AND no externalWalletAddress)`,
      );
    }
  }

  // Sort by payoutPriority ascending (lower = earlier, absorbs remainder later)
  const sorted = [...input.recipients].sort((a, b) => a.payoutPriority - b.payoutPriority);

  const transfers: SplitTransfer[] = [];
  let allocated = 0n;
  for (let i = 0; i < sorted.length - 1; i++) {
    const r = sorted[i]!;
    const amount = (input.amountUsdcBaseUnits * BigInt(r.bps)) / 10000n;
    transfers.push({
      recipientUserId: r.recipientUserId,
      recipientUsername: r.username,
      recipientRole: r.role,
      recipientAddress: (r.walletAddress ?? r.externalAddress)!,
      amountBaseUnits: amount,
      payoutPriority: r.payoutPriority,
    });
    allocated += amount;
  }
  const last = sorted[sorted.length - 1]!;
  const remainder = input.amountUsdcBaseUnits - allocated;
  transfers.push({
    recipientUserId: last.recipientUserId,
    recipientUsername: last.username,
    recipientRole: last.role,
    recipientAddress: (last.walletAddress ?? last.externalAddress)!,
    amountBaseUnits: remainder,
    payoutPriority: last.payoutPriority,
  });

  return {
    transfers,
    totalBaseUnits: input.amountUsdcBaseUnits,
    remainderAbsorbedByUsername: last.username,
  };
}