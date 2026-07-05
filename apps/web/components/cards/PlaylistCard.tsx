'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Play, ListMusic } from 'lucide-react';

export type PlaylistCardData = {
  id: string;
  title: string;
  coverUrl?: string | null;
  trackCount: number;
  ownerName?: string | null;
  description?: string | null;
};

type Props = { playlist: PlaylistCardData };

export function PlaylistCard({ playlist }: Props) {
  return (
    <Link
      href={`/playlist/${playlist.id}`}
      className="card card-hover-lift group relative block w-[200px] shrink-0 md:w-auto"
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-[#181818]">
        {playlist.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={playlist.coverUrl} alt={playlist.title} className="h-full w-full object-cover" />
        ) : (
          <div
            className="grid h-full w-full place-items-center"
            style={{ background: 'linear-gradient(135deg,#7B5EFF,#FF6BA9)' }}
          >
            <ListMusic className="h-12 w-12 text-white" />
          </div>
        )}
        <motion.div className="absolute bottom-2 right-2">
          <div className="grid h-11 w-11 translate-y-2 place-items-center rounded-full bg-[#00D4AA] text-[#001815] opacity-0 shadow-[0_8px_24px_rgba(0,212,170,0.45)] transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
            <Play className="h-5 w-5 fill-current" />
          </div>
        </motion.div>
      </div>
      <div className="mt-3 space-y-0.5">
        <div className="truncate text-sm font-bold text-white">{playlist.title}</div>
        <div className="truncate text-xs text-[#B3B3B3]">
          {playlist.trackCount} {playlist.trackCount === 1 ? 'track' : 'tracks'}
          {playlist.ownerName ? ` · ${playlist.ownerName}` : ''}
        </div>
      </div>
    </Link>
  );
}