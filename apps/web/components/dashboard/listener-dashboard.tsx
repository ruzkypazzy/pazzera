'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Play, Sparkles, TrendingUp, Wallet as WalletIcon, Music, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

interface DashboardData {
  user: { username: string; displayName: string | null };
  wallet: { balanceUsdc: string; address: string } | null;
  stats: { streamsToday: number; spentToday: string };
  recentlyPlayed: Array<{
    id: string;
    title: string;
    artist: string;
    coverUrl: string;
    durationSec: number;
  }>;
  trending: Array<{
    id: string;
    title: string;
    artist: string;
    coverUrl: string;
    durationSec: number;
    playCount: number;
    publishedPriceUsdc: string;
  }>;
  recommended: Array<{
    id: string;
    title: string;
    artist: string;
    coverUrl: string;
    publishedPriceUsdc: string;
  }>;
  isArtist: boolean;
}

export function ListenerDashboard({ initial }: { initial: DashboardData | null }) {
  const [data, setData] = useState<DashboardData | null>(initial);
  const [loading, setLoading] = useState(!initial);

  useEffect(() => {
    if (initial) return;
    // If initial wasn't pre-fetched, fetch on the client
    fetch('/api/dashboard/listener')
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [initial]);

  if (loading || !data) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="space-y-10">
      {/* Hero */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative overflow-hidden rounded-3xl border border-border glass-strong p-8 md:p-10 aurora"
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Badge variant="accent">
              <Sparkles className="h-3 w-3" /> Welcome back
            </Badge>
          </div>
          <h1 data-testid="user-greeting" className="text-3xl md:text-5xl font-bold tracking-tight">
            <span className="text-gradient-brand">{greeting()}, {data.user.displayName ?? data.user.username}</span>
          </h1>
          <p className="text-fg-muted max-w-xl">
            Your wallet is connected. Every stream you finish past the 25% threshold sends a nano payment directly to the artist.
            No subscriptions, no gatekeepers.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Link href="/search">
              <Button>
                <Music className="h-4 w-4 mr-2" /> Discover music
              </Button>
            </Link>
            <Link href="/wallet">
              <Button variant="secondary">
                <WalletIcon className="h-4 w-4 mr-2" /> Fund wallet
              </Button>
            </Link>
          </div>
        </div>
        {/* Decorative grid */}
        <div aria-hidden className="absolute -right-20 -top-20 h-80 w-80 rounded-full bg-accent/10 blur-3xl" />
      </motion.section>

      {/* Wallet summary + stats grid */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <WalletSummaryCard
          balance={data.wallet?.balanceUsdc ?? '0'}
          address={data.wallet?.address ?? ''}
        />
        <StatCard
          label="Streams today"
          value={String(data.stats.streamsToday)}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatCard
          label="Spent today"
          value={`${Number(data.stats.spentToday).toFixed(6)} USDC`}
          icon={<WalletIcon className="h-4 w-4" />}
        />
      </section>

      {/* Recently played */}
      {data.recentlyPlayed.length > 0 && (
        <section className="space-y-4">
          <SectionHeader title="Recently played" subtitle="Pick up where you left off" />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {data.recentlyPlayed.map((s) => (
              <SongCard key={s.id} song={s} />
            ))}
          </div>
        </section>
      )}

      {/* Trending */}
      <section className="space-y-4" data-testid="trending-section">
        <SectionHeader
          title="Trending on Pazzera"
          subtitle="What listeners are paying for right now"
          icon={<TrendingUp className="h-4 w-4 text-accent" />}
        />
        <div data-testid="trending-list" className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 no-scrollbar">
          {data.trending.map((s) => (
            <div key={s.id} className="w-48 shrink-0">
              <SongCard
                song={{
                  ...s,
                  artist: s.artist,
                }}
                showPrice
              />
            </div>
          ))}
        </div>
      </section>

      {/* Recommended */}
      <section className="space-y-4">
        <SectionHeader
          title="Recommended for you"
          subtitle="Discovery Agent picks (placeholder — recommendation engine lands in Phase 7)"
          icon={<Sparkles className="h-4 w-4 text-accent" />}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.recommended.map((s) => (
            <SongRow key={s.id} song={s} />
          ))}
        </div>
      </section>

      {/* Become an artist CTA */}
      {!data.isArtist && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="relative overflow-hidden rounded-3xl border border-accent/30 bg-gradient-to-br from-accent/10 via-bg-elevated to-bg-elevated p-8 md:p-12"
        >
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="max-w-xl">
              <Badge variant="accent" className="mb-3">For artists</Badge>
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight">
                Become an artist on Pazzera
              </h2>
              <p className="mt-2 text-fg-muted">
                Upload your music, set your price per stream, and get paid directly in USDC.
                No middlemen. No platform fees. Just your art and your fans.
              </p>
            </div>
            <Link href="/artist/onboarding">
              <Button size="lg" className="shrink-0">
                Start your application <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </div>
          <div aria-hidden className="absolute -right-10 -bottom-10 h-60 w-60 rounded-full bg-accent/10 blur-3xl" />
        </motion.section>
      )}
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function SectionHeader({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="text-xl md:text-2xl font-semibold tracking-tight flex items-center gap-2">
        {icon} {title}
      </h2>
      {subtitle && <p className="text-sm text-fg-muted mt-1">{subtitle}</p>}
    </div>
  );
}

function WalletSummaryCard({ balance, address }: { balance: string; address: string }) {
  return (
    <div className="rounded-2xl border border-border bg-bg-elevated p-5 col-span-1 sm:col-span-1">
      <div className="text-xs text-fg-muted uppercase tracking-wider">Balance</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">
        {Number(balance).toFixed(4)} <span className="text-fg-muted text-sm">USDC</span>
      </div>
      <div className="mt-2 text-xs text-fg-muted font-mono truncate">
        {address ? `${address.slice(0, 8)}…${address.slice(-6)}` : 'pending'}
      </div>
      <Link href="/wallet" className="mt-3 inline-block text-xs text-accent hover:underline">
        Manage wallet →
      </Link>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-bg-elevated p-5">
      <div className="flex items-center gap-2 text-xs text-fg-muted uppercase tracking-wider">
        {icon} {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

interface SongLite {
  id: string;
  title: string;
  artist: string;
  coverUrl: string;
  durationSec?: number;
  playCount?: number;
  publishedPriceUsdc?: string;
}

function SongCard({ song, showPrice }: { song: SongLite; showPrice?: boolean }) {
  return (
    <Link
      data-testid={`song-card-${song.id}`}
      data-song-id={song.id}
      href={`/song/${song.id}`}
      className="group rounded-xl border border-border bg-bg-elevated p-3 hover:border-fg-subtle transition block"
      onClick={() => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('pazzera:play', {
              detail: {
                songId: song.id,
                title: song.title,
                artist: song.artist,
                coverUrl: song.coverUrl,
                durationSec: song.durationSec ?? 0,
                pricePerStream: song.publishedPriceUsdc ?? '0.002',
              },
            }),
          );
        }
      }}
    >
      <div className="relative aspect-square overflow-hidden rounded-lg bg-bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={song.coverUrl}
          alt={song.title}
          className="h-full w-full object-cover transition group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-white text-bg opacity-0 group-hover:opacity-100 transition shadow-lg">
          <Play className="h-4 w-4 ml-0.5" />
        </div>
      </div>
      <div className="mt-3">
        <div className="truncate text-sm font-medium">{song.title}</div>
        <div className="truncate text-xs text-fg-muted">{song.artist}</div>
        {showPrice && song.publishedPriceUsdc && (
          <Badge variant="glass" className="mt-2">
            <span className="text-accent">●</span> {song.publishedPriceUsdc} USDC / stream
          </Badge>
        )}
      </div>
    </Link>
  );
}

function SongRow({ song }: { song: SongLite }) {
  return (
    <Link
      href={`/song/${song.id}`}
      className={cn(
        'flex items-center gap-3 rounded-xl border border-border bg-bg-elevated p-3 transition',
        'hover:border-fg-subtle',
      )}
    >
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={song.coverUrl} alt="" className="h-full w-full object-cover" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm font-medium">{song.title}</div>
        <div className="truncate text-xs text-fg-muted">{song.artist}</div>
      </div>
      {song.publishedPriceUsdc && (
        <Badge variant="glass" className="shrink-0">
          {song.publishedPriceUsdc} USDC
        </Badge>
      )}
      <button
        className="ml-1 rounded-full p-2 text-fg-muted hover:text-fg hover:bg-bg-muted transition"
        aria-label="Play"
      >
        <Play className="h-4 w-4" />
      </button>
    </Link>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-40 w-full rounded-3xl" />
      <div className="grid grid-cols-3 gap-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}