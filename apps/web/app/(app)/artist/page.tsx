import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/lib/session';
import { prisma } from '@pazzera/core';
import { ArtistDashboard } from '@/components/artist/artist-dashboard';

export const metadata = { title: 'Artist — Pazzera' };

export default async function ArtistPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/sign-in');
  const me = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { isArtist: true, onboardStatus: true },
  });
  if (!me?.isArtist) {
    redirect('/artist/onboarding');
  }
  return <ArtistDashboard initial={null} />;
}