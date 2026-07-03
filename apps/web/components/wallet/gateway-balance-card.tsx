'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Gateway Balance card — distinct from the on-chain wallet card.
 *
 * Pazzera settles via Circle Gateway batched nanopayments, which debit
 * the listener's Gateway Balance (held inside the Gateway Wallet contract).
 * This card surfaces that balance, recent Gateway activity, and a
 * one-click top-up flow that moves USDC from on-chain → Gateway.
 *
 * For artists, this also shows how much they've earned from streams
 * (still in Gateway Balance until they withdraw to on-chain USDC).
 */
interface GatewayState {
  ok: boolean;
  address: string;
  balanceUsdc: string;
  pendingBatchUsdc: string;
  onChainUsdc: string;
  recent: Array<{
    txId: string;
    amount: string;
    direction: 'credit' | 'debit';
    counterparty: string;
    ts: string;
    status: string;
  }>;
  error?: string;
}

export function GatewayBalanceCard({ role }: { role: 'listener' | 'artist' }) {
  const [g, setG] = useState<GatewayState | null>(null);
  const [topupAmount, setTopupAmount] = useState('10');
  const [withdrawAmount, setWithdrawAmount] = useState('1');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch('/api/wallet/gateway?refresh=1');
      const j = await r.json();
      setG(j);
    } catch (e) {
      setErr('Failed to load Gateway balance');
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  async function onTopup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await fetch('/api/wallet/gateway/topup', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': getCookie('csrf') ?? '',
        },
        body: JSON.stringify({ amountUsdc: topupAmount }),
      });
      const j = await r.json();
      if (!r.ok) {
        setErr(j?.error?.message ?? 'Top-up failed');
      } else {
        setMsg(
          `Submitted approve + deposit. Gateway Balance credits ~13 min after mining. ` +
          `Approve: ${j.approveTxId.slice(0, 8)}…  Deposit: ${j.depositTxId.slice(0, 8)}…`,
        );
        setTimeout(load, 5_000);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onWithdraw(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await fetch('/api/wallet/gateway/withdraw', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': getCookie('csrf') ?? '',
        },
        body: JSON.stringify({ amountUsdc: withdrawAmount }),
      });
      const j = await r.json();
      if (!r.ok) {
        setErr(j?.error?.message ?? 'Withdraw failed');
      } else {
        setMsg(`Withdrawal submitted: ${j.transferId.slice(0, 8)}… — settles shortly.`);
        setTimeout(load, 5_000);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  const balanceNum = parseFloat(g?.balanceUsdc ?? '0');
  const pendingNum = parseFloat(g?.pendingBatchUsdc ?? '0');
  const onChainNum = parseFloat(g?.onChainUsdc ?? '0');
  const isLow = balanceNum < 1;

  return (
    <section className="rounded-2xl border border-border bg-bg-elevated p-6 space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-xs text-fg-muted uppercase tracking-wider">
            Circle Gateway Balance
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <div className="text-4xl font-bold tabular-nums">
              {balanceNum.toFixed(6)}
            </div>
            <span className="text-sm text-fg-muted">USDC</span>
          </div>
          <div className="mt-1 text-xs text-fg-muted">
            {role === 'listener'
              ? 'Used to pay artists when you stream. Stream payments debit from here in real time.'
              : 'Earned from listener streams. Same-chain withdraw back to your on-chain USDC is instant.'}
          </div>
        </div>
        {g?.address && (
          <div className="text-right text-xs text-fg-muted">
            <div>Gateway wallet</div>
            <a
              href={`https://testnet.arcscan.app/address/${g.address}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-accent hover:underline"
            >
              {g.address.slice(0, 6)}…{g.address.slice(-4)}
            </a>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-bg-muted/50 px-3 py-2">
          <div className="text-[10px] text-fg-muted uppercase">On-chain USDC</div>
          <div className="text-sm font-semibold tabular-nums">{onChainNum.toFixed(6)}</div>
        </div>
        <div className="rounded-xl bg-bg-muted/50 px-3 py-2">
          <div className="text-[10px] text-fg-muted uppercase">In Gateway</div>
          <div className="text-sm font-semibold tabular-nums">{balanceNum.toFixed(6)}</div>
        </div>
        <div className="rounded-xl bg-bg-muted/50 px-3 py-2">
          <div className="text-[10px] text-fg-muted uppercase">Pending batch</div>
          <div className="text-sm font-semibold tabular-nums">{pendingNum.toFixed(6)}</div>
        </div>
      </div>

      {isLow && role === 'listener' && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          Gateway Balance is below 1 USDC — your next stream payment will trigger an auto top-up
          from your on-chain balance (10 USDC).
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <form onSubmit={onTopup} className="flex-1 flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-[10px] text-fg-muted uppercase">Top up from on-chain</label>
            <Input
              type="number"
              step="0.001"
              min="0.001"
              max="1000"
              value={topupAmount}
              onChange={(e) => setTopupAmount(e.target.value)}
              disabled={busy}
            />
          </div>
          <Button type="submit" disabled={busy} variant="primary" size="sm">
            {busy ? 'Submitting…' : 'Top up'}
          </Button>
        </form>
        <form onSubmit={onWithdraw} className="flex-1 flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-[10px] text-fg-muted uppercase">Withdraw to on-chain</label>
            <Input
              type="number"
              step="0.01"
              min="1"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              disabled={busy || balanceNum < 1}
            />
          </div>
          <Button type="submit" disabled={busy || balanceNum <= 0} variant="secondary" size="sm">
            {busy ? 'Submitting…' : 'Withdraw'}
          </Button>
        </form>
      </div>

      {msg && (
        <div className="rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent">
          {msg}
        </div>
      )}
      {err && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {err}
        </div>
      )}

      {g?.recent && g.recent.length > 0 && (
        <div>
          <div className="text-xs text-fg-muted mb-2">Recent Gateway activity</div>
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {g.recent.map((r, i) => (
              <div
                key={`${r.txId}-${i}`}
                className="flex items-center gap-2 rounded-lg bg-bg-muted/40 px-2.5 py-1.5 text-xs"
              >
                <span className={r.direction === 'credit' ? 'text-success' : 'text-danger'}>
                  {r.direction === 'credit' ? '+' : '-'}
                  {parseFloat(r.amount).toFixed(6)}
                </span>
                <span className="font-mono text-fg-muted truncate flex-1">
                  {r.counterparty ? `↔ ${r.counterparty.slice(0, 6)}…${r.counterparty.slice(-4)}` : ''}
                </span>
                <span className="text-[10px] text-fg-muted">{new Date(r.ts).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!g?.ok && (
        <div className="text-xs text-fg-muted">
          {g?.error ?? 'Loading Gateway balance…'}
        </div>
      )}
    </section>
  );
}

function getCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1] ?? '') : undefined;
}