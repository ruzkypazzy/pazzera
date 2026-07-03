'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, BarChart, Bar } from 'recharts';
import { DollarSign, Music2, ListMusic, Upload, TrendingUp, ArrowUpRight, Wallet as WalletIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { UploadDialog } from './upload-dialog';
import { GatewayBalanceCard } from '@/components/wallet/gateway-balance-card';

interface ArtistData {
  earnings: { totalUsdc: string; monthUsdc: string; todayUsdc: string };
  streams: { total: number; today: number; last30d: number; uniqueListeners30d: number };
  topSong: { id: string; title: string; coverUrl: string; streams: number; earnedUsdc: string } | null;
  walletBalance: string;
  trend: { date: string; streams: number; earnings: number }[];
  recentSongs: { id: string; title: string; coverUrl: string; status: string; playCount: number; publishedPriceUsdc: string; createdAt: string }[];
}

export function ArtistDashboard({ initial }: { initial: ArtistData | null }) {
  const [data, setData] = useState<ArtistData | null>(initial);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [loading, setLoading] = useState(!initial);

  useEffect(() => {
    if (initial) return;
    fetch('/api/artist/dashboard')
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [initial]);

  if (loading || !data) {
    return <ArtistSkeleton />;
  }

  return (
    <div className="mx-auto max-w-7xl px-4 md:px-8 py-6 space-y-8">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Artist dashboard</h1>
          <p className="text-fg-muted text-sm mt-1">Your music, your earnings, your audience.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/artist/manage">
            <Button variant="secondary">
              <ListMusic className="h-4 w-4 mr-2" /> Manage catalog
            </Button>
          </Link>
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4 mr-2" /> Upload music
          </Button>
        </div>
      </header>

      {/* Gateway Balance — earnings from stream payments + withdraw-to-onchain */}
      <div className="max-w-3xl">
        <GatewayBalanceCard role="artist" />
      </div>

      {/* KPI cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total earnings"
          value={`${Number(data.earnings.totalUsdc).toFixed(4)} USDC`}
          icon={<DollarSign className="h-4 w-4 text-accent" />}
          accent
        />
        <KpiCard
          label="This month"
          value={`${Number(data.earnings.monthUsdc).toFixed(4)} USDC`}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <KpiCard
          label="Streams today"
          value={String(data.streams.today)}
          icon={<Music2 className="h-4 w-4" />}
        />
        <KpiCard
          label="Wallet balance"
          value={`${Number(data.walletBalance).toFixed(4)} USDC`}
          icon={<WalletIcon className="h-4 w-4" />}
          href="/wallet"
        />
      </section>

      {/* Charts */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Streams (last 30 days)">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data.trend}>
              <defs>
                <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(142 76% 45%)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="hsl(142 76% 45%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="hsl(0 0% 14%)" strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke="hsl(0 0% 65%)" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="hsl(0 0% 65%)" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: 'hsl(0 0% 7%)', border: '1px solid hsl(0 0% 14%)', borderRadius: 8 }}
                labelStyle={{ color: 'hsl(0 0% 98%)' }}
              />
              <Area type="monotone" dataKey="streams" stroke="hsl(142 76% 45%)" fill="url(#g1)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Earnings (last 30 days)">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.trend}>
              <CartesianGrid stroke="hsl(0 0% 14%)" strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke="hsl(0 0% 65%)" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="hsl(0 0% 65%)" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: 'hsl(0 0% 7%)', border: '1px solid hsl(0 0% 14%)', borderRadius: 8 }}
                labelStyle={{ color: 'hsl(0 0% 98%)' }}
                formatter={(v: number) => `${v.toFixed(6)} USDC`}
              />
              <Bar dataKey="earnings" fill="hsl(142 76% 45%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </section>

      {/* Top song + recent songs */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {data.topSong && (
          <div className="lg:col-span-1 rounded-2xl border border-border bg-bg-elevated p-5">
            <div className="text-xs text-fg-muted uppercase tracking-wider">Top song</div>
            <div className="mt-3 flex items-center gap-3">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={data.topSong.coverUrl} alt="" className="h-full w-full object-cover" />
              </div>
              <div>
                <Link href={`/song/${data.topSong.id}`} className="text-sm font-medium hover:underline">
                  {data.topSong.title}
                </Link>
                <div className="text-xs text-fg-muted">{data.topSong.streams} streams</div>
                <div className="mt-1 text-xs text-accent tabular-nums">{data.topSong.earnedUsdc} USDC</div>
              </div>
            </div>
          </div>
        )}
        <div className="lg:col-span-2 rounded-2xl border border-border bg-bg-elevated p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs text-fg-muted uppercase tracking-wider">Recent uploads</div>
            <Link href="/artist/manage" className="text-xs text-accent hover:underline flex items-center gap-1">
              View all <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="space-y-2">
            {data.recentSongs.slice(0, 5).map((s) => (
              <Link
                key={s.id}
                href={`/song/${s.id}`}
                className="flex items-center gap-3 rounded-xl p-2 hover:bg-bg-muted transition"
              >
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.coverUrl} alt="" className="h-full w-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium">{s.title}</div>
                  <div className="text-xs text-fg-muted">{s.playCount} plays · {s.publishedPriceUsdc} USDC</div>
                </div>
                <Badge
                  variant={
                    s.status === 'published' ? 'success' : s.status === 'rejected' ? 'danger' : 'warning'
                  }
                >
                  {s.status}
                </Badge>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon,
  accent,
  href,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent?: boolean;
  href?: string;
}) {
  const content = (
    <div
      className={`rounded-2xl border p-5 transition ${
        accent
          ? 'border-accent/30 bg-accent/5 neon-ring'
          : 'border-border bg-bg-elevated hover:border-fg-subtle'
      }`}
    >
      <div className="flex items-center gap-2 text-xs text-fg-muted uppercase tracking-wider">
        {icon} {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-bg-elevated p-5">
      <div className="text-xs text-fg-muted uppercase tracking-wider mb-3">{title}</div>
      {children}
    </div>
  );
}

function ArtistSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}