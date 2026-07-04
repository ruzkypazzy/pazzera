import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getCurrentSession } from '@/lib/session';
import { prisma } from '@pazzera/core';
import { AppShell } from '@/components/shell/AppShell';
import { GatewayBalanceCard } from '@/components/wallet/gateway-balance-card';
import {
  DollarSign, Clock, Users, Music2, ExternalLink, TrendingUp, Upload,
  BarChart3, Sparkles, Music, Eye, Heart,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/sign-in?next=/dashboard');

  await headers();

  // Fetch role + listener data + (if artist) artist data, in parallel.
  const [user, wallet, payments, streams, uniqueArtists, mySongs, myEarnings] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { isArtist: true, role: true, username: true, displayName: true },
    }),
    prisma.wallet.findUnique({
      where: { userId: session.userId },
      select: { balanceUsdc: true, address: true },
    }),
    prisma.payment.findMany({
      where: { payerUserId: session.userId, status: 'completed' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { song: { include: { artist: { select: { username: true, displayName: true } } } } },
    }),
    prisma.stream.findMany({
      where: { userId: session.userId, endReason: { not: null } },
      orderBy: { startedAt: 'desc' },
      take: 200,
      select: { totalActiveMs: true, startedAt: true },
    }),
    prisma.payment.findMany({
      where: { payerUserId: session.userId, status: 'completed' },
      distinct: ['songId'],
      select: { songId: true },
    }),
    // Artist: own songs
    prisma.song.findMany({
      where: { artistId: session.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, title: true, coverUrl: true, durationSeconds: true, artistPriceUsdc: true, publishedPriceUsdc: true, createdAt: true },
    }),
    // Artist: earnings from their songs
    prisma.payment.findMany({
      where: { status: 'completed', song: { artistId: session.userId } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, amountUsdc: true, createdAt: true, songId: true },
    }),
  ]);

  const isArtist = Boolean(user?.isArtist) || user?.role === 'artist';
  const isAdmin = user?.role === 'admin';

  // === Listener aggregates ===
  const totalSpent = payments.reduce((acc, p) => acc + Number(p.amountUsdc || 0), 0);
  const totalListenMs = streams.reduce((acc, s) => acc + s.totalActiveMs, 0);
  const totalListenMin = Math.round(totalListenMs / 60000);
  const totalStreams = streams.length;

  const series = build14DaySeries(streams.map((s) => s.startedAt));
  const spentSeries = build14DaySpentSeries(
    payments.map((p) => ({ at: p.createdAt, amt: Number(p.amountUsdc || 0) })),
  );

  // === Artist aggregates ===
  const totalEarnedUsdc = myEarnings.reduce((acc, p) => acc + Number(p.amountUsdc || 0), 0);
  const totalEarningPayments = myEarnings.length;
  const earnedSeries = build14DaySpentSeries(
    myEarnings.map((p) => ({ at: p.createdAt, amt: Number(p.amountUsdc || 0) })),
  );
  // Top-earning song
  const earningsBySong = new Map<string, { title: string; coverUrl: string | null; total: number; plays: number }>();
  for (const p of myEarnings) {
    const cur = earningsBySong.get(p.songId) ?? {
      title: mySongs.find((s) => s.id === p.songId)?.title ?? 'Unknown',
      coverUrl: mySongs.find((s) => s.id === p.songId)?.coverUrl ?? null,
      total: 0,
      plays: 0,
    };
    cur.total += Number(p.amountUsdc || 0);
    cur.plays += 1;
    earningsBySong.set(p.songId, cur);
  }
  const topSongs = Array.from(earningsBySong.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return (
    <AppShell
      isArtist={isArtist}
      isAdmin={isAdmin}
      walletBalance={(Number(wallet?.balanceUsdc ?? 0)).toFixed(2)}
      displayName={user?.displayName ?? undefined}
      username={user?.username ?? undefined}
    >
      <div className="mx-auto max-w-screen-xl space-y-8 px-4 py-6 md:px-8">
        <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#B3B3B3]">
              {isArtist ? 'Artist Dashboard' : 'Dashboard'}
            </div>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white md:text-4xl">
              {isArtist ? (
                <>Your <span className="text-gradient-brand">music business</span></>
              ) : (
                <>Your listening <span className="text-gradient-teal">activity</span></>
              )}
            </h1>
            <p className="mt-2 text-sm text-[#B3B3B3]">
              {isArtist
                ? 'Earnings, plays, and audience — all in one place.'
                : 'Every stream, every USDC, every artist — all in one place.'}
            </p>
          </div>
          {isArtist && (
            <div className="flex gap-2">
              <Link href="/upload"><button className="btn-primary flex items-center gap-2"><Upload className="h-4 w-4" /> Upload track</button></Link>
              <Link href="/artist"><button className="btn-secondary flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Artist studio</button></Link>
            </div>
          )}
        </header>

        {/* Gateway Balance — live Circle Gateway holdings for both listeners and artists */}
        <div className="max-w-3xl">
          <GatewayBalanceCard role={isArtist ? 'artist' : 'listener'} />
        </div>

        {/* === ARTIST-ONLY: Top stats === */}
        {isArtist && (
          <section>
            <div className="mb-2 flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-[#C7B9FF]" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#C7B9FF]">Artist metrics</span>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <StatCard
                icon={<DollarSign className="h-4 w-4" />}
                label="Total earned"
                value={`$${totalEarnedUsdc.toFixed(4)}`}
                accent="brand"
              />
              <StatCard
                icon={<Music2 className="h-4 w-4" />}
                label="Tracks uploaded"
                value={mySongs.length.toLocaleString()}
                accent="teal"
              />
              <StatCard
                icon={<Eye className="h-4 w-4" />}
                label="Total plays"
                value={totalEarningPayments.toLocaleString()}
                accent="teal"
              />
              <StatCard
                icon={<Heart className="h-4 w-4" />}
                label="Top earning"
                value={topSongs[0] ? `$${topSongs[0].total.toFixed(4)}` : '$0.00'}
                accent="brand"
              />
            </div>
          </section>
        )}

        {/* === LISTENER-ONLY: Top stats === */}
        {!isArtist && (
          <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={<DollarSign className="h-4 w-4" />} label="Total USDC spent" value={`$${totalSpent.toFixed(4)}`} accent="teal" />
            <StatCard icon={<Clock className="h-4 w-4" />} label="Listening time" value={`${totalListenMin.toLocaleString()} min`} accent="brand" />
            <StatCard icon={<Users className="h-4 w-4" />} label="Artists supported" value={String(uniqueArtists.length)} accent="teal" />
            <StatCard icon={<Music2 className="h-4 w-4" />} label="Total streams" value={totalStreams.toLocaleString()} accent="brand" />
          </section>
        )}

        {/* === CHARTS ROW === */}
        <section className="grid gap-4 lg:grid-cols-2">
          {isArtist ? (
            <>
              <div className="card">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-white">Earnings (last 14 days)</h2>
                  <span className="badge-arc">Settled on Arc</span>
                </div>
                <div className="mt-4 h-48">
                  <MiniAreaChart data={earnedSeries} accent="#7B5EFF" />
                </div>
              </div>
              <div className="card">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-white">Top earning tracks</h2>
                  <Link href="/artist" className="text-xs font-bold uppercase tracking-wider text-[#C7B9FF] hover:underline">
                    See all
                  </Link>
                </div>
                <div className="mt-4 space-y-2">
                  {topSongs.length === 0 ? (
                    <p className="text-sm text-[#B3B3B3]">No plays yet — share your tracks to start earning.</p>
                  ) : (
                    topSongs.map((s, i) => (
                      <div key={i} className="flex items-center gap-3 rounded-lg border border-[#282828] bg-[#0F0F18] p-3">
                        <div className="grid h-10 w-10 place-items-center rounded-md bg-gradient-to-br from-[#7B5EFF] to-[#00F5E1] text-sm font-extrabold text-white">
                          {i + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-white">{s.title}</div>
                          <div className="text-[10px] text-[#B3B3B3]">{s.plays} paying plays</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-extrabold text-[#00D4AA]">${s.total.toFixed(4)}</div>
                          <div className="text-[10px] text-[#B3B3B3]">earned</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="card">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-white">Listening activity</h2>
                  <span className="badge-pay">Last 14 days</span>
                </div>
                <div className="mt-4 h-48">
                  <MiniBarChart data={series} />
                </div>
              </div>
              <div className="card">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-white">USDC spent</h2>
                  <span className="badge-arc">Settled on Arc</span>
                </div>
                <div className="mt-4 h-48">
                  <MiniAreaChart data={spentSeries} accent="#7B5EFF" />
                </div>
              </div>
            </>
          )}
        </section>

        {/* === RECENT PAYMENTS TABLE === */}
        <section className="card overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-[#282828] px-5 py-4">
            <h2 className="text-base font-bold text-white">
              {isArtist ? 'Recent earnings' : 'Recent payments'}
            </h2>
            <span className="text-xs text-[#B3B3B3]">
              {(isArtist ? myEarnings : payments).length} shown
            </span>
          </div>

          {isArtist ? (
            myEarnings.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <TrendingUp className="mx-auto h-8 w-8 text-[#B3B3B3]" />
                <p className="mt-3 text-sm text-[#B3B3B3]">No earnings yet — upload a track and share the link.</p>
                <Link href="/upload"><button className="btn-primary mt-4">Upload your first track</button></Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#282828] text-left text-[10px] font-bold uppercase tracking-widest text-[#B3B3B3]">
                      <th className="px-5 py-3">Track</th>
                      <th className="px-5 py-3 text-right">Earned</th>
                      <th className="px-5 py-3 text-right">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myEarnings.slice(0, 20).map((p) => {
                      const song = mySongs.find((s) => s.id === p.songId);
                      return (
                        <tr key={p.id} className="border-b border-[#282828]/40 transition hover:bg-[#181818]">
                          <td className="px-5 py-3 font-semibold text-white">{song?.title ?? 'Unknown'}</td>
                          <td className="px-5 py-3 text-right tabular-nums text-[#00D4AA]">${Number(p.amountUsdc).toFixed(6)}</td>
                          <td className="px-5 py-3 text-right text-xs text-[#B3B3B3]">{new Date(p.createdAt).toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : payments.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <TrendingUp className="mx-auto h-8 w-8 text-[#B3B3B3]" />
              <p className="mt-3 text-sm text-[#B3B3B3]">No payments yet — play a track to start paying artists in real time.</p>
              <Link href="/home"><button className="btn-primary mt-4">Browse music</button></Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#282828] text-left text-[10px] font-bold uppercase tracking-widest text-[#B3B3B3]">
                    <th className="px-5 py-3">Track</th>
                    <th className="px-5 py-3">Artist</th>
                    <th className="px-5 py-3 text-right">Amount</th>
                    <th className="px-5 py-3 text-right">When</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.slice(0, 20).map((p) => (
                    <tr key={p.id} className="border-b border-[#282828]/40 transition hover:bg-[#181818]">
                      <td className="px-5 py-3 font-semibold text-white">{p.song?.title ?? 'Unknown'}</td>
                      <td className="px-5 py-3 text-[#B3B3B3]">{p.song?.artist?.displayName ?? p.song?.artist?.username ?? '—'}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-[#00D4AA]">${Number(p.amountUsdc).toFixed(6)}</td>
                      <td className="px-5 py-3 text-right text-xs text-[#B3B3B3]">{new Date(p.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function StatCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: 'teal' | 'brand' }) {
  const ring = accent === 'teal' ? 'border-[#00D4AA]/30' : 'border-[#7B5EFF]/30';
  const bg = accent === 'teal' ? 'bg-[#00D4AA]/10' : 'bg-[#7B5EFF]/10';
  const color = accent === 'teal' ? 'text-[#00D4AA]' : 'text-[#C7B9FF]';
  return (
    <div className={`card ${ring}`}>
      <div className="flex items-center gap-2">
        <div className={`grid h-8 w-8 place-items-center rounded-full ${bg} ${color}`}>{icon}</div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-[#B3B3B3]">{label}</div>
      </div>
      <div className="mt-3 text-2xl font-extrabold tabular-nums text-white">{value}</div>
    </div>
  );
}

function build14DaySeries(dates: Date[]): { day: string; value: number }[] {
  const out: { day: string; value: number }[] = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const ymd = d.toISOString().slice(0, 10);
    const count = dates.filter((x) => x.toISOString().slice(0, 10) === ymd).length;
    out.push({ day: d.toLocaleDateString('en', { month: 'short', day: 'numeric' }), value: count });
  }
  return out;
}

function build14DaySpentSeries(payments: { at: Date; amt: number }[]): { day: string; value: number }[] {
  const out: { day: string; value: number }[] = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const ymd = d.toISOString().slice(0, 10);
    const sum = payments
      .filter((p) => p.at.toISOString().slice(0, 10) === ymd)
      .reduce((acc, p) => acc + p.amt, 0);
    out.push({ day: d.toLocaleDateString('en', { month: 'short', day: 'numeric' }), value: Number(sum.toFixed(6)) });
  }
  return out;
}

function MiniBarChart({ data }: { data: { day: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex h-full items-end gap-1">
      {data.map((d, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <div
            className="w-full rounded-t bg-gradient-to-t from-[#00D4AA]/40 to-[#00D4AA]"
            style={{ height: `${(d.value / max) * 100}%`, minHeight: 2 }}
            title={`${d.day}: ${d.value}`}
          />
          <div className="text-[8px] text-[#B3B3B3]">{i % 2 === 0 ? d.day : ''}</div>
        </div>
      ))}
    </div>
  );
}

function MiniAreaChart({ data, accent = '#7B5EFF' }: { data: { day: string; value: number }[]; accent?: string }) {
  const max = Math.max(0.0001, ...data.map((d) => d.value));
  const w = 100;
  const h = 100;
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (d.value / max) * h * 0.9 - 5;
    return `${x},${y}`;
  }).join(' ');
  const last = data[data.length - 1]?.value ?? 0;
  const gradId = `spent-${accent.replace('#', '')}`;
  return (
    <div className="relative h-full w-full">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.6" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,${h} ${points} ${w},${h}`} fill={`url(#${gradId})`} />
        <polyline points={points} fill="none" stroke={accent} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="absolute right-1 top-1 rounded bg-[#181818] px-2 py-0.5 text-[10px] font-bold tabular-nums text-white">
        ${last.toFixed(6)}
      </div>
    </div>
  );
}