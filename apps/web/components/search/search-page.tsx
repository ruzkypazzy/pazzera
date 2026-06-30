'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Search as SearchIcon, TrendingUp, Hash, User2, Music } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

interface SearchResults {
  songs: Array<{ id: string; title: string; artistName: string; artistUsername: string; coverUrl: string; publishedPriceUsdc: string }>;
  artists: Array<{ id: string; username: string; displayName: string | null; avatarUrl: string | null }>;
  users: Array<{ id: string; username: string; displayName: string | null; avatarUrl: string | null }>;
}

const FILTERS = ['all', 'songs', 'artists', 'people'] as const;
type Filter = (typeof FILTERS)[number];

const TRENDING = ['Lagos Sunrise', 'Pixel Dust', 'Midnight Protocol', 'house', 'lo-fi', 'afrobeats'];

const GENRE_CHIPS = ['house', 'lo-fi', 'afrobeats', 'jazz', 'ambient', 'hip-hop', 'electronic', 'classical'];

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/songs/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const empty = !query.trim();

  return (
    <div className="mx-auto max-w-5xl px-4 md:px-8 py-6 space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Search</h1>
        <p className="text-fg-muted text-sm">Find songs, artists, and people on Pazzera.</p>
      </header>

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-muted" />
        <Input
          autoFocus
          placeholder="What do you want to listen to?"
          className="pl-11 h-12 text-base"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-full px-3 py-1 text-xs capitalize transition',
              filter === f
                ? 'bg-accent text-accent-fg'
                : 'bg-bg-elevated text-fg-muted hover:text-fg',
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {empty ? (
        <div className="space-y-6">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium mb-3">
              <TrendingUp className="h-4 w-4 text-accent" /> Trending searches
            </div>
            <div className="flex flex-wrap gap-2">
              {TRENDING.map((t) => (
                <button
                  key={t}
                  onClick={() => setQuery(t)}
                  className="rounded-full border border-border bg-bg-elevated px-3 py-1.5 text-sm hover:border-fg-subtle transition"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 text-sm font-medium mb-3">
              <Hash className="h-4 w-4 text-accent" /> Browse by genre
            </div>
            <div className="flex flex-wrap gap-2">
              {GENRE_CHIPS.map((g) => (
                <button
                  key={g}
                  onClick={() => setQuery(g)}
                  className="rounded-full border border-border bg-bg-elevated px-3 py-1.5 text-sm hover:border-fg-subtle transition"
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : results && (results.songs.length + results.artists.length + results.users.length === 0) ? (
        <EmptyState query={query} />
      ) : results ? (
        <div className="space-y-8">
          {(filter === 'all' || filter === 'songs') && results.songs.length > 0 && (
            <ResultGroup icon={<Music className="h-4 w-4" />} title="Songs">
              {results.songs.map((s) => (
                <Link
                  key={s.id}
                  href={`/song/${s.id}`}
                  className="flex items-center gap-3 rounded-xl border border-border bg-bg-elevated p-3 hover:border-fg-subtle transition"
                >
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.coverUrl} alt="" className="h-full w-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm font-medium">{s.title}</div>
                    <div className="truncate text-xs text-fg-muted">@{s.artistUsername} · {s.artistName}</div>
                  </div>
                  <Badge variant="glass">{s.publishedPriceUsdc} USDC</Badge>
                </Link>
              ))}
            </ResultGroup>
          )}
          {(filter === 'all' || filter === 'artists') && results.artists.length > 0 && (
            <ResultGroup icon={<User2 className="h-4 w-4" />} title="Artists">
              {results.artists.map((a) => (
                <Link
                  key={a.id}
                  href={`/u/${a.username}`}
                  className="flex items-center gap-3 rounded-xl border border-border bg-bg-elevated p-3 hover:border-fg-subtle transition"
                >
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-bg-muted" />
                  <div>
                    <div className="text-sm font-medium">{a.displayName ?? a.username}</div>
                    <div className="text-xs text-fg-muted">@{a.username}</div>
                  </div>
                </Link>
              ))}
            </ResultGroup>
          )}
          {(filter === 'all' || filter === 'people') && results.users.length > 0 && (
            <ResultGroup icon={<User2 className="h-4 w-4" />} title="People">
              {results.users.map((u) => (
                <Link
                  key={u.id}
                  href={`/u/${u.username}`}
                  className="flex items-center gap-3 rounded-xl border border-border bg-bg-elevated p-3 hover:border-fg-subtle transition"
                >
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-bg-muted" />
                  <div>
                    <div className="text-sm font-medium">{u.displayName ?? u.username}</div>
                    <div className="text-xs text-fg-muted">@{u.username}</div>
                  </div>
                </Link>
              ))}
            </ResultGroup>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ResultGroup({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 text-sm font-medium mb-3">
        {icon} {title}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="rounded-2xl border border-border bg-bg-elevated p-12 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-bg-muted">
        <SearchIcon className="h-5 w-5 text-fg-muted" />
      </div>
      <div className="text-sm font-medium">No results for &ldquo;{query}&rdquo;</div>
      <p className="text-xs text-fg-muted mt-1">Try a different keyword or browse trending.</p>
    </div>
  );
}