/**
 * Split Agent — pure decision function.
 *
 * Builds the list of (recipient, amount) transfers for a settled payment,
 * enforcing percentage invariants.
 */
export interface SplitRecipient {
  username: string;
  walletAddress: string;
  role: 'artist' | 'featured' | 'producer';
  /** Basis points (10000 = 100%). */
  bps: number;
}

export interface SplitInput {
  paymentId: string;
  amountUsdcBaseUnits: bigint;
  recipients: SplitRecipient[];
}

export interface SplitOutput {
  transfers: { recipientAddress: string; recipientUsername: string; amountBaseUnits: bigint }[];
  totalBaseUnits: bigint;
  remainderBaseUnits: bigint;
}

export function decideSplit(input: SplitInput): SplitOutput {
  const totalBps = input.recipients.reduce((s, r) => s + r.bps, 0);
  if (totalBps !== 10000) {
    throw new Error(
      `Recipient bps must sum to 10000, got ${totalBps}`,
    );
  }
  if (input.recipients.length === 0) {
    throw new Error('No recipients configured');
  }

  // Distribute base units exactly, last recipient absorbs the remainder
  // (basis-points math rarely lands on integer boundaries)
  const transfers: SplitOutput['transfers'] = [];
  let allocated = 0n;
  for (let i = 0; i < input.recipients.length - 1; i++) {
    const r = input.recipients[i]!;
    const amount = (input.amountUsdcBaseUnits * BigInt(r.bps)) / 10000n;
    transfers.push({
      recipientAddress: r.walletAddress,
      recipientUsername: r.username,
      amountBaseUnits: amount,
    });
    allocated += amount;
  }
  const last = input.recipients[input.recipients.length - 1]!;
  const remainder = input.amountUsdcBaseUnits - allocated;
  transfers.push({
    recipientAddress: last.walletAddress,
    recipientUsername: last.username,
    amountBaseUnits: remainder,
  });

  return {
    transfers,
    totalBaseUnits: input.amountUsdcBaseUnits,
    remainderBaseUnits: 0n,
  };
}