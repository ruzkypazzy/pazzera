'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Play, Pause, SkipBack, SkipForward, Volume2, Zap } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

interface PlayerState {
  songId: string;
  title: string;
  artist: string;
  coverUrl: string;
  durationSec: number;
  positionSec: number;
  playing: boolean;
  pricePerStream: string;
  paymentActive: boolean; // true when a payment just fired
}

const PLACEHOLDER: PlayerState = {
  songId: '',
  title: 'Select something to play',
  artist: 'Pazzera',
  coverUrl: '',
  durationSec: 0,
  positionSec: 0,
  playing: false,
  pricePerStream: '0.002',
  paymentActive: false,
};

/**
 * Sticky player footer. Phase 5 uses a local placeholder state; Phase 8
 * wires the real Socket.IO-driven playback session.
 */
export function StickyPlayer() {
  const [state, setState] = useState<PlayerState>(PLACEHOLDER);

  // Listen for play-this from any page
  useEffect(() => {
    function onPlay(e: Event) {
      const ce = e as CustomEvent<Partial<PlayerState>>;
      setState((prev) => ({ ...prev, ...ce.detail, playing: true }));
      // Simulate the "payment just fired" pulse 2s in
      setTimeout(() => {
        setState((p) => ({ ...p, paymentActive: true }));
        setTimeout(() => setState((p) => ({ ...p, paymentActive: false })), 2000);
      }, 2000);
    }
    window.addEventListener('pazzera:play', onPlay as EventListener);
    return () => window.removeEventListener('pazzera:play', onPlay as EventListener);
  }, []);

  const progress = state.durationSec > 0 ? (state.positionSec / state.durationSec) * 100 : 0;
  const isEmpty = !state.songId;

  return (
    <motion.div
      initial={false}
      animate={state.paymentActive ? { boxShadow: '0 0 0 2px hsl(142 100% 60% / 0.6), 0 0 40px hsl(142 100% 60% / 0.3)' } : { boxShadow: '0 -8px 32px rgba(0,0,0,0.4)' }}
      transition={{ duration: 0.3 }}
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-border glass-strong"
    >
      <div className="flex h-20 items-center gap-4 px-4 md:px-6">
        {/* Left — cover + title */}
        <div className="flex items-center gap-3 w-1/3 min-w-0">
          <div
            className={cn(
              'h-12 w-12 shrink-0 rounded-lg bg-bg-muted overflow-hidden flex items-center justify-center',
              state.paymentActive && 'neon-ring',
            )}
          >
            {state.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={state.coverUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-fg-muted text-xs">♪</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{state.title}</div>
            <div className="truncate text-xs text-fg-muted">{state.artist}</div>
          </div>
        </div>

        {/* Center — controls + seek */}
        <div className="flex flex-1 flex-col items-center gap-1">
          <div className="flex items-center gap-3">
            <button
              disabled={isEmpty}
              className="rounded-full p-1.5 text-fg-muted hover:text-fg disabled:opacity-30 disabled:hover:text-fg-muted transition"
              aria-label="Previous"
            >
              <SkipBack className="h-4 w-4" />
            </button>
            <button
              disabled={isEmpty}
              onClick={() => setState((p) => ({ ...p, playing: !p.playing }))}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full transition',
                isEmpty
                  ? 'bg-bg-muted text-fg-muted'
                  : 'bg-white text-bg hover:scale-105',
              )}
              aria-label={state.playing ? 'Pause' : 'Play'}
            >
              {state.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
            </button>
            <button
              disabled={isEmpty}
              className="rounded-full p-1.5 text-fg-muted hover:text-fg disabled:opacity-30 disabled:hover:text-fg-muted transition"
              aria-label="Next"
            >
              <SkipForward className="h-4 w-4" />
            </button>
          </div>
          <div className="flex w-full max-w-md items-center gap-2">
            <span className="text-[10px] tabular-nums text-fg-muted">
              {formatTime(state.positionSec)}
            </span>
            <div className="relative h-1 flex-1 rounded-full bg-bg-muted">
              <div
                className={cn(
                  'absolute inset-y-0 left-0 rounded-full bg-fg-muted transition-all',
                  state.paymentActive && 'bg-accent',
                )}
                style={{ width: `${progress}%` }}
              />
              {/* Threshold marker (25%) — shows when payment triggers */}
              {!isEmpty && (
                <div className="absolute inset-y-0 w-px bg-accent/60" style={{ left: '25%' }} />
              )}
            </div>
            <span className="text-[10px] tabular-nums text-fg-muted">
              {formatTime(state.durationSec)}
            </span>
          </div>
        </div>

        {/* Right — volume + price + payment indicator */}
        <div className="hidden md:flex w-1/3 items-center justify-end gap-4">
          <div
            className={cn(
              'flex items-center gap-2 rounded-full px-3 py-1 text-xs transition',
              state.paymentActive
                ? 'bg-accent/20 text-accent neon-ring'
                : 'bg-bg-elevated text-fg-muted',
            )}
            title="Price per stream"
          >
            <Zap className="h-3 w-3" />
            <span className="tabular-nums">{state.pricePerStream} USDC</span>
          </div>
          <button className="text-fg-muted hover:text-fg transition" aria-label="Volume">
            <Volume2 className="h-4 w-4" />
          </button>
          {!isEmpty && state.songId && (
            <Link
              href={`/song/${state.songId}`}
              className="rounded-full border border-border px-3 py-1 text-xs text-fg-muted hover:text-fg hover:border-fg-muted transition"
            >
              Open
            </Link>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}