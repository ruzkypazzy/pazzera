import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/lib/session';
import { GuestShell } from '@/components/shell/GuestShell';
import { LandingHero } from '@/components/landing/LandingHero';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function LandingPage() {
  // If user is already authed, bounce them to the home dashboard.
  if (await getCurrentSession()) redirect('/home');

  return (
    <GuestShell>
      <LandingHero />
    </GuestShell>
  );
}