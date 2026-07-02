'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Play, Pause, Sparkles, Users, DollarSign, Music, TrendingUp } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

interface SongData {
  id: string;
  slug: string;
  title: string;
  artistName: string;
  artistUsername: string;
  featuredNames: string[];
  producerName: string | null;
  description: string | null;
  coverUrl: string;
  audioUrl: string;
  durationSeconds: number;
  publishedPriceUsdc: string;
  playCount: number;
  totalEarnedUsdc: string;
  completionRate: number;
  recipients: { username: string; role: string; percentageBps: number; walletAddress?: string }[];
  trend: { date: string; streams: number }[];
}

export function SongPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<SongData | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/songs/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d.song ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  if (loading) return <SongSkeleton />;
  if (!data) return <div className="p-12 text-center text-fg-muted">Song not found.</div>;

  return (
    <div className="mx-auto max-w-5xl px-4 md:px-8 py-8 space-y-8">
      {/* Hero */}
      <section className="flex flex-col md:flex-row gap-6 items-start">
        <div className="relative w-56 h-56 md:w-64 md:h-64 shrink-0 overflow-hidden rounded-2xl shadow-2xl neon-ring">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={data.coverUrl} alt={data.title} className="h-full w-full object-cover" />
        </div>
        <div className="flex-1 min-w-0 space-y-3">
          <Badge variant="accent">{data.artistUsername}</Badge>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">{data.title}</h1>
          <p className="text-fg-muted">
            {data.artistName}
            {data.featuredNames.length > 0 && ` · feat. ${data.featuredNames.join(', ')}`}
            {data.producerName && ` · prod. ${data.producerName}`}
          </p>
          {data.description && <p className="text-sm text-fg-muted max-w-2xl leading-relaxed">{data.description}</p>}

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <Button
              data-testid="play-button"
              size="lg"
              onClick={() => {
                setPlaying((p) => !p);
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(
                    new CustomEvent('pazzera:play', {
                      detail: {
                        id: data.id,
                        slug: data.slug ?? data.id,
                        title: data.title,
                        artistName: data.artistName,
                        artistUsername: data.artistUsername ?? '',
                        coverUrl: data.coverUrl,
                        audioUrl: data.audioUrl,
                        durationSeconds: data.durationSeconds,
                        publishedPriceUsdc: data.publishedPriceUsdc,
                      },
                    }),
                  );
                }
              }}
            >
              {playing ? <Pause className="h-4 w-4 mr-2" /> : <Play className="h-4 w-4 mr-2" />}
              {playing ? 'Playing' : 'Play'}
            </Button>
            <Badge variant="glass" className="text-base px-3 py-1">
              <Sparkles className="h-3 w-3 text-accent" />
              <span className="tabular-nums text-accent">{data.publishedPriceUsdc}</span>
              <span className="text-fg-muted">USDC / stream</span>
            </Badge>
            <span className="text-xs text-fg-muted">
              {Math.floor(data.durationSeconds / 60)}:{(data.durationSeconds % 60).toString().padStart(2, '0')}
            </span>
          </div>
        </div>
      </section>

      {/* Analytics */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Kpi icon={<Music className="h-4 w-4 text-accent" />} label="Total streams" value={String(data.playCount)} />
        <Kpi icon={<DollarSign className="h-4 w-4 text-accent" />} label="Total earned" value={`${Number(data.totalEarnedUsdc).toFixed(4)} USDC`} />
        <Kpi icon={<TrendingUp className="h-4 w-4 text-accent" />} label="Completion rate" value={`${(data.completionRate * 100).toFixed(0)}%`} />
      </section>

      {/* Streams trend */}
      <section className="rounded-2xl border border-border bg-bg-elevated p-5">
        <div className="flex items-center gap-2 text-xs text-fg-muted uppercase tracking-wider mb-3">
          <TrendingUp className="h-4 w-4" /> Streams (last 30 days)
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data.trend}>
            <CartesianGrid stroke="hsl(0 0% 14%)" strokeDasharray="3 3" />
            <XAxis dataKey="date" stroke="hsl(0 0% 65%)" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis stroke="hsl(0 0% 65%)" fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ background: 'hsl(0 0% 7%)', border: '1px solid hsl(0 0% 14%)', borderRadius: 8 }} />
            <Line type="monotone" dataKey="streams" stroke="hsl(142 76% 45%)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </section>

      {/* Credits */}
      <section className="rounded-2xl border border-border bg-bg-elevated p-5">
        <div className="flex items-center gap-2 text-xs text-fg-muted uppercase tracking-wider mb-3">
          <Users className="h-4 w-4" /> Royalty recipients
        </div>
        <div className="space-y-2">
          {data.recipients.map((r, i) => (
            <div
              key={i}
              className={cn(
                'flex items-center justify-between rounded-xl border border-border bg-bg-elevated/50 p-3',
              )}
            >
              <div>
                <div className="text-sm font-medium">{r.username}</div>
                <div className="text-xs text-fg-muted capitalize">{r.role.replace('_', ' ')}</div>
              </div>
              <div className="text-sm tabular-nums text-accent">{(r.percentageBps / 100).toFixed(0)}%</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-bg-elevated p-5">
      <div className="flex items-center gap-2 text-xs text-fg-muted uppercase tracking-wider">
        {icon} {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function SongSkeleton() {
  return (
    <div className="mx-auto max-w-5xl px-4 md:px-8 py-8 space-y-8">
      <div className="flex gap-6">
        <Skeleton className="h-64 w-64 rounded-2xl" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>
      <Skeleton className="h-32" />
    </div>
  );
}