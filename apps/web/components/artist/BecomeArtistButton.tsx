'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Music } from 'lucide-react';
import { BecomeArtistModal } from './BecomeArtistModal';

type Props = {
  isAuthed: boolean;
  isArtist: boolean;
  variant?: 'primary' | 'secondary';
  className?: string;
};

/**
 * "Become an artist" CTA — branches on auth state:
 *  - signed-in listener  → open inline modal (no page nav)
 *  - signed-in artist   → link to /upload (no action)
 *  - guest              → link to /sign-up?intent=artist (the chooser page)
 */
export function BecomeArtistButton({ isAuthed, isArtist, variant = 'secondary', className = '' }: Props) {
  const [open, setOpen] = useState(false);

  // Artist? Just go to upload.
  if (isAuthed && isArtist) {
    return (
      <Link href="/upload">
        <button className={variant === 'primary' ? 'btn-primary' : 'btn-secondary'}>
          <Music className="h-4 w-4" /> Upload a track
        </button>
      </Link>
    );
  }

  // Listener: open the inline upgrade modal.
  if (isAuthed) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={variant === 'primary' ? 'btn-primary' : 'btn-secondary'}
        >
          <Music className="h-4 w-4" /> Become an artist
        </button>
        <BecomeArtistModal open={open} onClose={() => setOpen(false)} />
      </>
    );
  }

  // Guest: send to the sign-up chooser.
  return (
    <Link href="/sign-up?intent=artist">
      <button className={variant === 'primary' ? 'btn-primary' : 'btn-secondary'}>
        <Music className="h-4 w-4" /> Become an artist
      </button>
    </Link>
  );
}