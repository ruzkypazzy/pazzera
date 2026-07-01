'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface WalletState {
  address: string;
  status: string;
  provider: string;
  custody: string;
  balanceUsdc: string;
  pendingUsdc: string;
  x402DailyCapUsdc: string;
  x402PerStreamCapUsdc: string;
  x402AuthorizedAt: string | null;
  frozenAt: string | null;
  compromisedAt: string | null;
  recoveryRequestedAt: string | null;
}

interface DepositInfo {
  address: string;
  chain: { id: number; explorer: string; rpc: string };
  token: { symbol: string; address: string; decimals: number };
  qrDataUrl: string;
  faucet: { url: string; notes: string[] };
}

interface TxRow {
  id: string;
  type: string;
  direction: 'credit' | 'debit';
  amountUsdc: string;
  status: string;
  txHash: string | null;
  counterpartyAddress: string | null;
  createdAt: string;
  confirmedAt: string | null;
  memo: string | null;
}

export function WalletClient() {
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [deposit, setDeposit] = useState<DepositInfo | null>(null);
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);

  // Withdraw form
  const [withdrawTo, setWithdrawTo] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawResult, setWithdrawResult] = useState<string | null>(null);

  // Backup / Export
  const [exportConfirm, setExportConfirm] = useState('');
  const [exportResult, setExportResult] = useState<{ privateKey?: string; address?: string; warning?: string; message?: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);

  async function exportKey() {
    const normalized = exportConfirm.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized !== 'i understand') return;
    setExporting(true);
    setExportErr(null);
    try {
      const r = await fetch('/api/wallet/export', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'I understand' }),
      });
      const data = await r.json();
      if (!r.ok) {
        setExportErr(data?.error?.message || 'Export failed');
      } else {
        setExportResult(data);
      }
    } catch (e) {
      setExportErr((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  async function loadAll() {
    const [w, d, t] = await Promise.all([
      fetch('/api/wallet/balance?refresh=1').then((r) => r.json()),
      fetch('/api/wallet/deposit').then((r) => r.json()),
      fetch('/api/wallet/transactions?limit=25').then((r) => r.json()),
    ]);
    if (w?.ok) setWallet(w.wallet);
    if (d?.ok) setDeposit(d);
    if (t?.ok) setTxs(t.transactions);
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function copyAddress() {
    if (!deposit?.address) return;
    try {
      await navigator.clipboard.writeText(deposit.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy to clipboard');
    }
  }

  async function onWithdraw(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setWithdrawResult(null);
    setPending(true);
    try {
      const res = await fetch('/api/wallet/withdraw', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': getCookie('csrf') ?? '' },
        body: JSON.stringify({ toAddress: withdrawTo, amountUsdc: withdrawAmount }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Withdraw failed');
      } else {
        setWithdrawResult(`Withdrew ${withdrawAmount} USDC — tx ${data.txHash.slice(0, 10)}…`);
        setWithdrawTo('');
        setWithdrawAmount('');
        await loadAll();
      }
    } finally {
      setPending(false);
    }
  }

  if (!wallet) {
    return (
      <div className="rounded-2xl border border-border bg-bg-elevated p-8 text-center text-fg-muted">
        Setting up your wallet… hang tight.
      </div>
    );
  }

  if (wallet.status === 'pending_provisioning') {
    return (
      <div className="rounded-2xl border border-accent/30 bg-accent/5 p-8 text-center">
        <div className="text-fg font-medium">Wallet provisioning in progress</div>
        <p className="text-fg-muted text-sm mt-2">
          Your Arc USDC wallet is being created. This usually takes a few seconds.
        </p>
        <button
          onClick={loadAll}
          className="mt-4 text-xs text-accent hover:underline"
        >
          Refresh
        </button>
      </div>
    );
  }

  if (wallet.status === 'frozen' || wallet.status === 'compromised') {
    return (
      <div className="rounded-2xl border border-danger/40 bg-danger/10 p-8">
        <div className="text-fg font-medium capitalize">Wallet {wallet.status}</div>
        <p className="text-fg-muted text-sm mt-2">
          {wallet.status === 'frozen'
            ? 'Your wallet has been frozen. Contact support to resolve.'
            : 'Your wallet has been flagged as compromised. Use the recovery flow to rotate keys.'}
        </p>
        <a
          href="/wallet/recovery"
          className="mt-4 inline-block text-sm text-accent hover:underline"
        >
          Start recovery →
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Balance card */}
      <section className="rounded-2xl border border-border bg-bg-elevated p-6">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-xs text-fg-muted uppercase tracking-wider">Available balance</div>
            <div className="mt-1 text-4xl font-bold tabular-nums">
              {Number(wallet.balanceUsdc).toFixed(6)} <span className="text-fg-muted text-base">USDC</span>
            </div>
            {Number(wallet.pendingUsdc) > 0 && (
              <div className="mt-1 text-xs text-fg-muted">
                {Number(wallet.pendingUsdc).toFixed(6)} pending
              </div>
            )}
          </div>
          <div className="text-right text-xs text-fg-muted space-y-1">
            <div>Provider: <span className="text-fg">{wallet.provider}</span></div>
            <div>Custody: <span className="text-fg">{wallet.custody === 'user' ? 'You (UCW)' : 'Pazzera (dev mode)'}</span></div>
            <div>Daily x402 cap: <span className="text-fg">{wallet.x402DailyCapUsdc} USDC</span></div>
          </div>
        </div>
      </section>
      {/* Backup / Export */}
      <section className="rounded-2xl border border-border bg-bg-elevated p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Backup & export</h2>
            <p className="text-sm text-fg-muted mt-1 max-w-prose">
              {wallet.custody === 'user'
                ? 'Your wallet is user-controlled. Use this section to download a one-time copy of your private key so you can recover the wallet from MetaMask or any other EVM tool.'
                : "This wallet is provisioned in Pazzera's local dev mode — the private key is encrypted on the server. You can export it once below and import it into MetaMask to take self-custody."}
            </p>
          </div>
        </div>

        {!exportResult ? (
          <div className="mt-5 space-y-3">
            <label className="block text-sm">
              <span className="text-fg-muted">
                Type <span className="font-mono text-fg">I understand</span> to reveal your private key:
              </span>
              <Input
                type="text"
                value={exportConfirm}
                onChange={(e) => setExportConfirm(e.target.value)}
                placeholder="I understand"
                className="mt-2"
              />
            </label>
            {exportErr && (
              <div className="text-sm text-danger">{exportErr}</div>
            )}
            <Button
              type="button"
              onClick={exportKey}
              disabled={exporting || exportConfirm.replace(/\s+/g, ' ').trim().toLowerCase() !== 'i understand'}
              variant="secondary"
            >
              {exporting ? 'Revealing…' : 'Reveal private key'}
            </Button>
            <p className="text-xs text-fg-muted">
              The key is decrypted from Pazzera's encrypted store, sent over TLS, and never logged.
              Once you close this page we can\u2019t show it again — save it somewhere safe.
            </p>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {exportResult.privateKey ? (
              <>
                <div className="text-sm text-fg-muted">Address</div>
                <div className="font-mono text-xs break-all bg-bg p-3 rounded-lg border border-border">
                  {exportResult.address}
                </div>
                <div className="text-sm text-fg-muted mt-3">Private key</div>
                <div className="font-mono text-xs break-all bg-bg p-3 rounded-lg border border-danger/40 text-danger select-all">
                  {exportResult.privateKey}
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-accent/40 bg-accent/10 p-4 text-sm text-fg">
                {exportResult.message}
              </div>
            )}
            {exportResult.warning && (
              <p className="text-xs text-danger">{exportResult.warning}</p>
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setExportResult(null);
                setExportConfirm('');
              }}
            >
              Done
            </Button>
          </div>
        )}
      </section>

      {/* Deposit panel */}
      {deposit && (
        <section className="rounded-2xl border border-border bg-bg-elevated p-6">
          <h2 className="text-lg font-semibold">Deposit USDC</h2>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
            <div className="flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={deposit.qrDataUrl}
                alt="Deposit address QR"
                className="rounded-xl border border-border"
                width={200}
                height={200}
              />
            </div>
            <div className="space-y-3">
              <div>
                <div className="text-xs text-fg-muted mb-1">Your address</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 break-all rounded-lg bg-bg px-3 py-2 text-sm">
                    {deposit.address}
                  </code>
                  <Button size="sm" variant="secondary" onClick={copyAddress}>
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </div>
              <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 text-sm">
                <div className="font-medium text-fg">Get testnet USDC (Arc faucet)</div>
                <ol className="mt-2 list-decimal list-inside text-fg-muted space-y-1">
                  {deposit.faucet.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ol>
                <a
                  href={deposit.faucet.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block text-accent hover:underline text-sm"
                >
                  Open faucet →
                </a>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Withdraw form */}
      <section className="rounded-2xl border border-border bg-bg-elevated p-6">
        <h2 className="text-lg font-semibold">Withdraw</h2>
        <form onSubmit={onWithdraw} className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_180px_auto] gap-3">
          <Input
            placeholder="Destination 0x… address"
            value={withdrawTo}
            onChange={(e) => setWithdrawTo(e.target.value)}
            required
          />
          <Input
            placeholder="Amount USDC"
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
            required
            inputMode="decimal"
          />
          <Button type="submit" disabled={pending}>
            {pending ? 'Sending…' : 'Withdraw'}
          </Button>
        </form>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        {withdrawResult && <p className="mt-3 text-sm text-accent">{withdrawResult}</p>}
      </section>

      {/* Transaction history */}
      <section className="rounded-2xl border border-border bg-bg-elevated p-6">
        <h2 className="text-lg font-semibold">Recent activity</h2>
        {txs.length === 0 ? (
          <p className="mt-4 text-sm text-fg-muted">No transactions yet.</p>
        ) : (
          <table className="mt-4 w-full text-sm">
            <thead className="text-xs text-fg-muted uppercase tracking-wider">
              <tr className="text-left">
                <th className="py-2">Type</th>
                <th className="py-2 text-right">Amount</th>
                <th className="py-2">Status</th>
                <th className="py-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {txs.map((t) => (
                <tr key={t.id} className="border-t border-border">
                  <td className="py-3">
                    <span className="capitalize">{t.type.replace('_', ' ')}</span>
                    {t.txHash && (
                      <a
                        href={`https://testnet.arcscan.app/tx/${t.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 text-xs text-fg-muted hover:text-accent"
                      >
                        ↗
                      </a>
                    )}
                  </td>
                  <td
                    className={`py-3 text-right tabular-nums ${
                      t.direction === 'credit' ? 'text-accent' : 'text-fg'
                    }`}
                  >
                    {t.direction === 'credit' ? '+' : '−'}
                    {Number(t.amountUsdc).toFixed(6)}
                  </td>
                  <td className="py-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs capitalize ${
                        t.status === 'confirmed'
                          ? 'bg-accent/10 text-accent'
                          : t.status === 'failed'
                            ? 'bg-danger/10 text-danger'
                            : 'bg-bg-muted text-fg-muted'
                      }`}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="py-3 text-fg-muted text-xs">
                    {new Date(t.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name}=`));
  return match?.split('=')[1] ?? null;
}