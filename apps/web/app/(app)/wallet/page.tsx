import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/lib/session';
import { WalletClient } from '@/components/wallet/wallet-client';

export const metadata = { title: 'Wallet — Pazzera' };

export default async function WalletPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/sign-in');
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Wallet</h1>
        <p className="text-fg-muted text-sm mt-1">
          Deposit, withdraw, and stream. Your funds, your keys.
        </p>
      </header>
      <WalletClient />
    </div>
  );
}