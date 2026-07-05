import Link from 'next/link';
import { AppShell } from '@/components/shell/AppShell';
import { headers } from 'next/headers';
import { prisma } from '@pazzera/core';

export const dynamic = 'force-dynamic';

type Props = { params: { id: string } };

export default async function ArtistProfilePage({ params }: Props) {
  await headers();
  const artist = await prisma.user
    .findUnique({
      where: { id: params.id },
      select: {
        id: true,
        username: true,
        displayName: true,
        bio: true,
        avatarUrl: true,
        createdAt: true,
      },
    })
    .catch(() => null);

  if (!artist) {
    return (
      <AppShell>
        <div className="mx-auto max-w-screen-md px-4 py-16 text-center md:px-8">
          <h1 className="text-2xl font-bold">Artist not found</h1>
          <p className="mt-2 text-white/55">This profile may have been removed or never existed.</p>
          <Link href="/home"><button className="btn-primary mt-6">Back to home</button></Link>
        </div>
      </AppShell>
    );
  }

  const tracks = await prisma.song
    .findMany({
      where: { artistId: artist.id },
      orderBy: { createdAt: 'desc' },
      take: 24,
    })
    .catch(() => []);

  return (
    <AppShell>
      <div className="mx-auto max-w-screen-xl space-y-8 px-4 py-6 md:px-8">
        <header className="flex flex-col gap-5 md:flex-row md:items-end">
          <div
            className="grid h-32 w-32 shrink-0 place-items-center overflow-hidden rounded-full ring-4 ring-white/15"
            style={{ background: 'linear-gradient(135deg,#7B5EFF,#00F5E1)' }}
          >
            {artist.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={artist.avatarUrl} alt={artist.displayName ?? artist.username} className="h-full w-full object-cover" />
            ) : (
              <span className="text-5xl font-extrabold text-white">{(artist.displayName ?? artist.username).charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div className="flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">Artist</div>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight md:text-4xl">
              {artist.displayName ?? artist.username}
            </h1>
            {artist.bio && <p className="mt-2 max-w-2xl text-sm text-white/65">{artist.bio}</p>}
            <div className="mt-3 text-xs text-white/45">
              @{artist.username} · Joined {new Date(artist.createdAt).toLocaleDateString()}
            </div>
          </div>
        </header>

        <section>
          <h2 className="mb-3 text-xl font-bold">Tracks</h2>
          {tracks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-6 text-center">
              <p className="text-sm text-white/55">This artist hasn&apos;t uploaded anything yet.</p>
            </div>
          ) : (
            <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 no-scrollbar md:grid md:grid-cols-3 md:gap-4 md:overflow-visible md:px-0 lg:grid-cols-6">
              {tracks.map((t: any) => (
                <Link key={t.id} href={`/song/${t.id}`} className="card w-[180px] shrink-0 md:w-auto">
                  <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-gradient-to-br from-[#7B5EFF]/40 to-[#00F5E1]/40">
                    {t.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.coverUrl} alt={t.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center text-3xl font-extrabold text-white/95 mix-blend-overlay">
                        {t.title?.charAt(0) ?? '?'}
                      </div>
                    )}
                  </div>
                  <div className="mt-3 truncate text-sm font-semibold">{t.title}</div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}