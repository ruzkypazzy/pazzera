import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/lib/session';
import { PaymentToastHost } from '@/components/realtime/payment-toast-host';
import { PlayerBar } from '@/components/shell/PlayerBar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();
  if (!session) redirect('/sign-in?next=/home');

  // Global authed layout. The PlayerBar lives here so it's mounted on
  // every authed page, including /song/[id] (which doesn't wrap in
  // AppShell). It owns the real <audio> element that listens for
  // pazzera:play events and actually plays music.
  return (
    <>
      {children}
      <PaymentToastHost />
      <PlayerBar />
    </>
  );
}