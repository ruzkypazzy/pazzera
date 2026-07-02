import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/shell/AppShell';
import { TrackCard } from '@/components/cards/TrackCard';
import { PlaylistCard } from '@/components/cards/PlaylistCard';
import { SectionRow } from '@/components/cards/SectionRow';
import { BecomeArtistButton } from '@/components/artist/BecomeArtistButton';
import { getCurrentSession } from '@/lib/session';
import { prisma } from '@pazzera/core';
import { getHomeFeed } from '@/lib/queries/home';
import { Sparkles, TrendingUp, Radio, Music2, Wallet, ArrowUpRight } from 'lucide-react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function HomePage() {
  const session = await getCurrentSession();
  if (!session) redirect('/sign-in?next=/home');

  // Pull feed + user/role in parallel
  const [feed, user, wallet] = await Promise.all([
    getHomeFeed(),
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { username: true, displayName: true, isArtist: true, role: true, avatarUrl: true },
    }),
    prisma.wallet.findUnique({
      where: { userId: session.userId },
      select: { balanceUsdc: true },
    }),
  ]);

  const isArtist = Boolean(user?.isArtist) || user?.role === 'artist';
  const isAdmin = user?.role === 'admin';
  const firstName = (user?.displayName ?? user?.username ?? 'friend').split(' ')[0];
  const greeting = greetingForHour();
  const balance = wallet?.balanceUsdc ?? '0';
  const balanceNum = Number(balance);
  const balanceStr = Number.isFinite(balanceNum) ? balanceNum.toFixed(2) : '0.00';

  // Pick a "Made for you" track — first trending or first new release
  const madeForYou = feed.trending[0] ?? feed.newReleases[0] ?? null;

  return (
    <AppShell
      isArtist={isArtist}
      isAdmin={isAdmin}
      walletBalance={balanceStr}
    >
      <div className="mx-auto max-w-screen-xl space-y-8 px-4 py-6 md:px-8">
        {/* === HERO === */}
        <section className="relative overflow-hidden rounded-2xl border border-[#282828] bg-gradient-to-br from-[#121212] to-[#0A0A0A] p-6 md:p-10">
          <div
            className="absolute inset-0 -z-10 opacity-50"
            style={{
              background:
                'radial-gradient(600px 280px at 90% 0%, rgba(0,212,170,0.18), transparent 60%),' +
                'radial-gradient(500px 280px at 0% 100%, rgba(123,94,255,0.20), transparent 55%)',
            }}
          />
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[#00D4AA]/30 bg-[#00D4AA]/10 px-3 py-1">
                <Sparkles className="h-3 w-3 text-[#00D4AA]" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#00D4AA]">
                  {greeting}, {firstName}
                </span>
              </div>
              <h1 className="mt-4 text-4xl font-extrabold leading-tight tracking-tight md:text-6xl">
                <span className="text-gradient-brand">Stream the artist.</span>
                <br />
                <span className="text-white">Pay the artist.</span>
              </h1>
              <p className="mt-3 max-w-lg text-sm text-[#B3B3B3] md:text-base">
                Every second of play pays artists directly in USDC. No subscription, no middlemen.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link href="/search"><button className="btn-primary">Discover music →</button></Link>
                <BecomeArtistButton isAuthed={true} isArtist={isArtist} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <Stat n={feed.totalArtists} label="Artists" />
              <Stat n={feed.totalTracks} label="Tracks" />
              <Stat n={feed.totalPlays} label="Plays" />
            </div>
          </div>
        </section>

        {/* === Wallet strip === */}
        <section className="flex flex-col gap-3 rounded-xl border border-[#00D4AA]/25 bg-[#0F1A18] p-4 md:flex-row md:items-center md:justify-between md:p-5">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-[#00D4AA]/20 text-[#00D4AA]">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-[#B3B3B3]">Your wallet</div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-extrabold tabular-nums text-white">{balanceStr}</span>
                <span className="text-xs font-semibold text-[#00D4AA]">USDC</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/wallet?tab=send"><button className="btn-secondary !py-1.5 !px-3 text-xs">Send</button></Link>
            <Link href="/wallet?tab=receive"><button className="btn-secondary !py-1.5 !px-3 text-xs">Receive</button></Link>
            <Link href="/wallet"><button className="btn-primary !py-1.5 !px-3 text-xs">Top up</button></Link>
          </div>
        </section>

        {/* === Curator Agent pick (single large card) === */}
        {madeForYou && (
          <section className="card relative overflow-hidden">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#C7B9FF]" />
              <span className="badge-agent">Curator Agent</span>
              <span className="text-xs text-[#B3B3B3]">— Made for you, based on your listening</span>
            </div>
            <div className="mt-4 flex flex-col gap-5 md:flex-row md:items-center">
              <div className="aspect-square w-44 shrink-0 overflow-hidden rounded-xl bg-[#181818]">
                {madeForYou.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={madeForYou.coverUrl} alt={madeForYou.title} className="h-full w-full object-cover" />
                ) : (
                  <div
                    className="grid h-full w-full place-items-center text-6xl font-extrabold text-white"
                    style={{ background: 'linear-gradient(135deg,#7B5EFF,#00F5E1)' }}
                  >
                    {madeForYou.title.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="flex-1">
                <div className="text-xs font-semibold uppercase tracking-widest text-[#B3B3B3]">Now playing</div>
                <div className="mt-1 truncate text-2xl font-extrabold text-white md:text-3xl">{madeForYou.title}</div>
                <div className="mt-1 text-sm text-[#B3B3B3]">by {madeForYou.artistName}</div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {madeForYou.audioUrl ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (typeof window !== 'undefined') {
                          window.dispatchEvent(
                            new CustomEvent('pazzera:play', {
                              detail: {
                                id: madeForYou.id,
                                slug: madeForYou.slug ?? madeForYou.id,
                                title: madeForYou.title,
                                artistName: madeForYou.artistName,
                                artistUsername: madeForYou.artistUsername ?? '',
                                coverUrl: madeForYou.coverUrl ?? '',
                                audioUrl: madeForYou.audioUrl,
                                durationSeconds: madeForYou.durationSeconds ?? 0,
                                publishedPriceUsdc: madeForYou.publishedPriceUsdc ?? '0.003',
                              },
                            }),
                          );
                        }
                      }}
                      className="btn-primary !py-2 !px-4 text-sm"
                    >▶ Play</button>
                  ) : (
                    <Link href={`/song/${madeForYou.id}`}><button className="btn-primary !py-2 !px-4 text-sm">▶ Play</button></Link>
                  )}
                  <span className="badge-pay">${madeForYou.rateUsdc.toFixed(4)} / stream</span>
                  <span className="badge-arc">Settled on Arc</span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* === AI-curated sections (real DB) === */}
        {feed.recentlyPlayed.length > 0 && (
          <SectionRow
            title="Recently played"
            subtitle="Your last listens"
            agent="fan"
            showAllHref="/library"
          >
            {feed.recentlyPlayed.slice(0, 6).map((t) => (
              <TrackCard
                key={`recent-${t.id}`}
                track={{
                  id: t.id,
                  slug: t.slug,
                  title: t.title,
                  artistName: t.artistName,
                  artistUsername: t.artistUsername,
                  artistId: t.artistId,
                  coverUrl: t.coverUrl ?? null,
                  audioUrl: t.audioUrl ?? null,
                  durationSeconds: t.durationSeconds,
                  publishedPriceUsdc: t.publishedPriceUsdc,
                  ratePerStreamUsdc: t.rateUsdc,
                  totalPlays: t.totalPlays,
                  recommendedBy: 'fan',
                }}
              />
            ))}
          </SectionRow>
        )}

        {feed.trending.length > 0 && (
          <SectionRow
            title="Trending on Arc"
            subtitle="Real streams, real payouts — last 24h"
            agent="discovery"
            showAllHref="/search?sort=trending"
          >
            {feed.trending.slice(0, 6).map((t) => (
              <TrackCard
                key={`trend-${t.id}`}
                track={{
                  id: t.id,
                  slug: t.slug,
                  title: t.title,
                  artistName: t.artistName,
                  artistUsername: t.artistUsername,
                  artistId: t.artistId,
                  coverUrl: t.coverUrl ?? null,
                  audioUrl: t.audioUrl ?? null,
                  durationSeconds: t.durationSeconds,
                  publishedPriceUsdc: t.publishedPriceUsdc,
                  ratePerStreamUsdc: t.rateUsdc,
                  totalEarningsUsdc: t.totalEarningsUsdc,
                  totalPlays: t.totalPlays,
                  recommendedBy: 'trending',
                }}
              />
            ))}
          </SectionRow>
        )}

        {feed.newReleases.length > 0 && (
          <SectionRow
            title="New releases"
            subtitle="Fresh uploads from independent artists"
            showAllHref="/search?sort=new"
          >
            {feed.newReleases.slice(0, 6).map((t) => (
              <TrackCard
                key={`new-${t.id}`}
                track={{
                  id: t.id,
                  slug: t.slug,
                  title: t.title,
                  artistName: t.artistName,
                  artistUsername: t.artistUsername,
                  artistId: t.artistId,
                  coverUrl: t.coverUrl ?? null,
                  audioUrl: t.audioUrl ?? null,
                  durationSeconds: t.durationSeconds,
                  publishedPriceUsdc: t.publishedPriceUsdc,
                  ratePerStreamUsdc: t.rateUsdc,
                  recommendedBy: 'new',
                }}
              />
            ))}
          </SectionRow>
        )}

        {feed.featuredArtists.length > 0 && (
          <SectionRow
            title="Top artists"
            subtitle="Most earnings across the platform"
            showAllHref="/search?type=artists"
          >
            {feed.featuredArtists.slice(0, 6).map((a) => (
              <Link
                key={a.id}
                href={`/profile/${a.id}`}
                className="card card-hover-lift flex flex-col items-center gap-2 text-center"
              >
                <div className="relative aspect-square w-full max-w-[120px] overflow-hidden rounded-full bg-[#181818]">
                  {a.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.avatarUrl} alt={a.displayName ?? a.username} className="h-full w-full object-cover" />
                  ) : (
                    <div
                      className="grid h-full w-full place-items-center text-3xl font-extrabold text-white"
                      style={{ background: 'linear-gradient(135deg,#7B5EFF,#00F5E1)' }}
                    >
                      {(a.displayName ?? a.username).charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="truncate text-sm font-bold text-white">{a.displayName ?? a.username}</div>
                <div className="text-[10px] tabular-nums text-[#00D4AA]">
                  {a.totalEarningsUsdc > 0 ? `$${a.totalEarningsUsdc.toFixed(2)} earned` : 'New artist'}
                </div>
                <span className="badge-arc !text-[8px]">Settled on Arc</span>
              </Link>
            ))}
          </SectionRow>
        )}

        {feed.playlists.length > 0 && (
          <SectionRow
            title="Curated playlists"
            subtitle="Updated recently"
            showAllHref="/search?type=playlists"
          >
            {feed.playlists.slice(0, 6).map((p) => (
              <PlaylistCard
                key={p.id}
                playlist={{
                  id: p.id,
                  title: p.title,
                  coverUrl: p.coverUrl ?? null,
                  trackCount: p.trackCount,
                  ownerName: p.ownerName,
                }}
              />
            ))}
          </SectionRow>
        )}

        {/* === Empty state === */}
        {!feed.hasAnyContent && (
          <section className="rounded-2xl border border-dashed border-[#282828] bg-[#121212] p-8 text-center md:p-12">
            <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[#00D4AA]/15 text-[#00D4AA]">
              <Music2 className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-2xl font-bold tracking-tight text-white">No music yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-[#B3B3B3]">
              Pazzera starts empty and grows with real uploads. Be the first artist to push a track.
            </p>
            <div className="mt-5">
              <BecomeArtistButton isAuthed={true} isArtist={isArtist} variant="primary" />
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div className="text-2xl font-extrabold tabular-nums text-white md:text-3xl">{n.toLocaleString()}</div>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-[#B3B3B3]">{label}</div>
    </div>
  );
}

function greetingForHour(): string {
  const h = new Date().getUTCHours();
  if (h < 5) return 'Late night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}