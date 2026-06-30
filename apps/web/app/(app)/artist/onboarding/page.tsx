import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/lib/session';
import { ArtistOnboardingForm } from '@/components/artist/onboarding-form';

export const metadata = { title: 'Become an artist — Pazzera' };

export default async function OnboardingPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/sign-in');
  return (
    <div className="mx-auto max-w-2xl px-4 md:px-8 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Become an artist</h1>
      <p className="text-fg-muted text-sm mt-1">
        Tell us about you. Once approved, you can upload music and start receiving direct USDC payouts.
      </p>
      <div className="mt-6 rounded-2xl border border-border glass-strong p-6">
        <ArtistOnboardingForm />
      </div>
    </div>
  );
}