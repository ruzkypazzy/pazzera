import Link from 'next/link';
import { AppShell } from '@/components/shell/AppShell';
import { prisma } from '@pazzera/core';

export const dynamic = 'force-dynamic';

type Props = { params: { id: string } };

export default async function PlaylistPage({ params }: Props) {
  const playlist = await (prisma as any).playlist
    ?.findUnique({
      where: { id: params.id },
      include: { owner: { select: { username: true, displayName: true } } },
    })
    .catch(() => null);

  if (!playlist) {
    return (
      <AppShell>
        <div className="mx-auto max-w-screen-md px-4 py-16 text-center md:px-8">
          <h1 className="text-2xl font-bold">Playlist not found</h1>
          <p className="mt-2 text-white/55">This playlist may have been removed.</p>
          <Link href="/home"><button className="btn-primary mt-6">Back to home</button></Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-screen-xl space-y-6 px-4 py-6 md:px-8">
        <header className="flex flex-col gap-5 md:flex-row md:items-end">
          <div className="grid h-32 w-32 shrink-0 place-items-center overflow-hidden rounded-2xl ring-4 ring-white/15"
            style={{ background: 'linear-gradient(135deg,#7B5EFF,#FF6BA9)' }}>
            <span className="text-5xl font-extrabold text-white">{(playlist.title ?? '?').charAt(0).toUpperCase()}</span>
          </div>
          <div className="flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">Playlist</div>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight md:text-4xl">{playlist.title}</h1>
            <div className="mt-2 text-sm text-white/55">
              by {playlist.owner?.displayName ?? playlist.owner?.username ?? 'Unknown'} · {playlist.trackCount ?? 0} tracks
            </div>
          </div>
        </header>
        <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-6 text-center text-sm text-white/55">
          Playlist details page coming soon.
        </div>
      </div>
    </AppShell>
  );
}