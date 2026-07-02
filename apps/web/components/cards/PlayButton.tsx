'use client';

import Link from 'next/link';

type Props = {
  trackId: string;
  className?: string;
  children?: React.ReactNode;
  // The full track shape needed to dispatch pazzera:play
  audioUrl?: string | null;
  title: string;
  artistName: string;
  artistUsername?: string;
  coverUrl?: string | null;
  durationSeconds?: number;
  publishedPriceUsdc?: string;
  slug?: string;
};

/**
 * Small client-side Play button that:
 *  - If the track has an audioUrl, dispatches pazzera:play (so the
 *    layout-level PlayerBar starts playback without navigating).
 *  - Otherwise, navigates to /song/[id] as a fallback.
 *
 * This lives as a client component so the home page (a server
 * component) can pass an onClick handler through the client/server
 * boundary cleanly.
 */
export function PlayButton({
  trackId,
  className = 'btn-primary !py-2 !px-4 text-sm',
  children,
  audioUrl,
  title,
  artistName,
  artistUsername,
  coverUrl,
  durationSeconds,
  publishedPriceUsdc,
  slug,
}: Props) {
  const handleClick = () => {
    if (!audioUrl || typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('pazzera:play', {
        detail: {
          id: trackId,
          slug: slug ?? trackId,
          title,
          artistName,
          artistUsername: artistUsername ?? '',
          coverUrl: coverUrl ?? '',
          audioUrl,
          durationSeconds: durationSeconds ?? 0,
          publishedPriceUsdc: publishedPriceUsdc ?? '0.002',
        },
      }),
    );
  };

  if (audioUrl) {
    return (
      <button type="button" onClick={handleClick} className={className}>
        {children ?? '▶ Play'}
      </button>
    );
  }
  return (
    <Link href={`/song/${trackId}`}>
      <button type="button" className={className}>
        {children ?? '▶ Play'}
      </button>
    </Link>
  );
}
