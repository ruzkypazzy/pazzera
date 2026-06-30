'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Heart, ListMusic, Clock, Download, Music } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

interface LibItem {
  id: string;
  title: string;
  artist: string;
  coverUrl: string;
  durationSec: number;
  publishedPriceUsdc: string;
  playedAt: string;
}

export function LibraryPage() {
  const [tab, setTab] = useState('liked');
  const [items, setItems] = useState<LibItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/library/${tab}`)
      .then((r) => r.json())
      .then((d) => {
        setItems(d.items ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [tab]);

  return (
    <div className="mx-auto max-w-5xl px-4 md:px-8 py-6 space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Your library</h1>
        <p className="text-fg-muted text-sm mt-1">Your liked songs, playlists, and recent streams.</p>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="liked"><Heart className="h-3.5 w-3.5 mr-1.5" /> Liked</TabsTrigger>
          <TabsTrigger value="playlists"><ListMusic className="h-3.5 w-3.5 mr-1.5" /> Playlists</TabsTrigger>
          <TabsTrigger value="recent"><Clock className="h-3.5 w-3.5 mr-1.5" /> Recent</TabsTrigger>
          <TabsTrigger value="downloads" disabled>
            <Download className="h-3.5 w-3.5 mr-1.5" /> Downloads
          </TabsTrigger>
        </TabsList>

        <TabsContent value="liked">
          <EmptyOr loading={loading} items={items} kind="liked" />
        </TabsContent>
        <TabsContent value="playlists">
          <EmptyOr loading={loading} items={items} kind="playlists" />
        </TabsContent>
        <TabsContent value="recent">
          <EmptyOr loading={loading} items={items} kind="recent" />
        </TabsContent>
        <TabsContent value="downloads">
          <div className="rounded-2xl border border-border bg-bg-elevated p-8 text-center text-fg-muted text-sm">
            Downloads coming in a future release. (Offline mode is intentionally gated for the hackathon demo.)
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyOr({
  loading,
  items,
  kind,
}: {
  loading: boolean;
  items: LibItem[];
  kind: 'liked' | 'playlists' | 'recent';
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-bg-elevated p-12 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-bg-muted">
          <Music className="h-5 w-5 text-fg-muted" />
        </div>
        <div className="text-sm font-medium">
          {kind === 'liked'
            ? 'No liked songs yet'
            : kind === 'playlists'
              ? 'No playlists yet'
              : 'No recent streams yet'}
        </div>
        <p className="text-xs text-fg-muted mt-1">
          {kind === 'liked' ? 'Tap the heart on any song to add it here.' : kind === 'playlists' ? 'Create a playlist to organize your music.' : 'Songs you stream will appear here.'}
        </p>
        <Link href="/search" className="mt-4 inline-block text-xs text-accent hover:underline">
          Discover music →
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((it) => (
        <Link
          key={it.id}
          href={`/song/${it.id}`}
          className="flex items-center gap-3 rounded-xl border border-border bg-bg-elevated p-3 hover:border-fg-subtle transition"
        >
          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={it.coverUrl} alt="" className="h-full w-full object-cover" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="truncate text-sm font-medium">{it.title}</div>
            <div className="truncate text-xs text-fg-muted">{it.artist}</div>
          </div>
          <Badge variant="glass">{it.publishedPriceUsdc} USDC</Badge>
        </Link>
      ))}
    </div>
  );
}