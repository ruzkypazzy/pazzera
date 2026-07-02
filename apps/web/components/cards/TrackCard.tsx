'use client';

import { Play, Sparkles, Zap } from 'lucide-react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';

export type TrackCardData = {
  id: string;
  slug?: string;
  title: string;
  artistName: string;
  artistId?: string;
  artistUsername?: string;
  coverUrl?: string | null;
  audioUrl?: string | null;
  durationSeconds?: number;
  publishedPriceUsdc?: string;
  ratePerStreamUsdc: number;
  totalEarningsUsdc?: number;
  totalPlays?: number;
  // Pazzera-specific: which agent recommended it
  recommendedBy?: 'curator' | 'discovery' | 'fan' | 'trending' | 'new';
};

type Props = {
  track: TrackCardData;
  variant?: 'default' | 'wide' | 'compact';
};

const AGENT_LABEL: Record<NonNullable<TrackCardData['recommendedBy']>, string> = {
  curator: 'Curator Agent',
  discovery: 'Discovery Agent',
  fan: 'Fan Agent',
  trending: 'Trending on Arc',
  new: 'New release',
};

export function TrackCard({ track, variant = 'default' }: Props) {
  const showWhy = !!track.recommendedBy && track.recommendedBy !== 'trending' && track.recommendedBy !== 'new';

  // Click handler — dispatch pazzera:play so the layout-level
  // PlayerBar starts audio. If no audioUrl, fall through to the link.
  const handleClick = (e: React.MouseEvent) => {
    if (track.audioUrl) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('pazzera:play', {
            detail: {
              id: track.id,
              slug: track.slug ?? track.id,
              title: track.title,
              artistName: track.artistName,
              artistUsername: track.artistUsername ?? '',
              coverUrl: track.coverUrl ?? '',
              audioUrl: track.audioUrl,
              durationSeconds: track.durationSeconds ?? 0,
              publishedPriceUsdc: track.publishedPriceUsdc ?? String(track.ratePerStreamUsdc),
            },
          }),
        );
      }
    }
  };

  return (
    <Link
      href={`/song/${track.id}`}
      onClick={handleClick}
      className="card card-hover-lift group relative block w-[180px] shrink-0 md:w-auto"
    >
      {/* Cover */}
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-[#181818]">
        {track.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={track.coverUrl} alt={track.title} className="h-full w-full object-cover" />
        ) : (
          <div
            className="grid h-full w-full place-items-center text-4xl font-extrabold text-white/95"
            style={{ background: 'linear-gradient(135deg,#7B5EFF,#00F5E1)' }}
          >
            {track.title.charAt(0).toUpperCase()}
          </div>
        )}

        {/* Top-left: agent badge or trending/earnings */}
        {track.recommendedBy && (
          <div className="absolute left-2 top-2">
            {track.recommendedBy === 'trending' && track.totalEarningsUsdc ? (
              <span className="badge-pay !text-[9px]">
                <Zap className="h-2.5 w-2.5 fill-current" /> ${track.totalEarningsUsdc.toFixed(2)}
              </span>
            ) : track.recommendedBy === 'new' ? (
              <span className="badge-arc !text-[9px]">New</span>
            ) : (
              <span className="badge-agent !text-[9px]">
                <Sparkles className="h-2.5 w-2.5" /> {AGENT_LABEL[track.recommendedBy]}
              </span>
            )}
          </div>
        )}

        {/* Top-right: pay rate */}
        <div className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[9px] font-bold tabular-nums text-white backdrop-blur">
          ${track.ratePerStreamUsdc.toFixed(4)} / stream
        </div>

        {/* Play button — appears on hover */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          whileHover={{ opacity: 1, y: 0 }}
          className="absolute bottom-2 right-2"
        >
          <div className="grid h-11 w-11 translate-y-2 place-items-center rounded-full bg-[#00D4AA] text-[#001815] opacity-0 shadow-[0_8px_24px_rgba(0,212,170,0.45)] transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
            <Play className="h-5 w-5 fill-current" />
          </div>
        </motion.div>
      </div>

      {/* Meta */}
      <div className="mt-3 space-y-0.5">
        <div className="truncate text-sm font-bold text-white">{track.title}</div>
        <div className="truncate text-xs text-[#B3B3B3]">{track.artistName}</div>
        <div className="flex items-center gap-1.5 pt-1">
          <span className="badge-pay !text-[8px]">Pay · Live</span>
          {track.totalPlays !== undefined && track.totalPlays > 0 && (
            <span className="text-[9px] tabular-nums text-[#B3B3B3]">· {track.totalPlays}×</span>
          )}
          {showWhy && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                // Hook into "Why this track?" tooltip/modal — placeholder
                if (typeof window !== 'undefined') {
                  window.alert(`Recommended by ${AGENT_LABEL[track.recommendedBy!]} because it matches your listening history.`);
                }
              }}
              className="text-[9px] text-[#00D4AA] hover:underline"
            >
              Why?
            </button>
          )}
        </div>
      </div>
    </Link>
  );
}