import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/lib/session';
import { prisma } from '@pazzera/core';
import { PaymentToastHost } from '@/components/realtime/payment-toast-host';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();
  if (!session) redirect('/sign-in?next=/home');

  // Each authed page wraps its own <AppShell/> (with role-aware variants), so the
  // layout only needs to ensure auth + global realtime toasts. Playback is handled
  // by the AppShell's <PlayerBar /> (which owns the real <audio> element).
  return (
    <>
      {children}
      <PaymentToastHost />
    </>
  );
}