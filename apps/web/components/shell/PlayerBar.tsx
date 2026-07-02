'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Repeat, Shuffle, Heart, Sparkles, Zap } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

export type Track = {
  id: string;
  title: string;
  artistName: string;
  artistId?: string;
  coverUrl?: string | null;
  durationSec: number;
  ratePerStreamUsdc: number; // e.g. 0.003
};

type Props = {
  track?: Track;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  onSkipNext?: () => void;
  onSkipPrev?: () => void;
  // If true, shows the 25% threshold warning (manual override; otherwise auto-derives from progress)
  paymentTriggered?: boolean;
};

const PAYMENT_THRESHOLD = 0.25; // Pazzera spec: 25% triggers the USDC charge

export function PlayerBar({
  track,
  isPlaying = false,
  onTogglePlay,
  onSkipNext,
  onSkipPrev,
  paymentTriggered,
}: Props) {
  const [progress, setProgress] = useState(0); // 0..1
  const [volume, setVolume] = useState(0.7);
  const [muted, setMuted] = useState(false);
  const [liked, setLiked] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Simulated playback — in production, the WebSocket stream drives this.
  // We tick 250ms at a time so the progress bar feels smooth.
  useEffect(() => {
    if (!track || !isPlaying) {
      if (tickRef.current) clearInterval(tickRef.current);
      return;
    }
    tickRef.current = setInterval(() => {
      setProgress((p) => {
        const next = p + 0.25 / track.durationSec;
        if (next >= 1) {
          if (tickRef.current) clearInterval(tickRef.current);
          return 1;
        }
        return next;
      });
    }, 250);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [track, isPlaying]);

  // Reset progress when track changes
  useEffect(() => {
    setProgress(0);
  }, [track?.id]);

  const rate = track?.ratePerStreamUsdc ?? 0.003;
  const elapsedSec = (track?.durationSec ?? 0) * progress;
  const accruedUsdc = elapsedSec * rate;
  const triggered = paymentTriggered ?? progress >= PAYMENT_THRESHOLD;
  const elapsedStr = formatTime(elapsedSec);
  const durationStr = formatTime(track?.durationSec ?? 0);

  return (
    <div
      className="fixed inset-x-0 z-30 h-[80px] border-t border-[#282828]"
      style={{
        bottom: '68px',
        background: 'rgba(18,18,18,0.92)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
      }}
    >
      <div className="mx-auto flex h-full max-w-screen-2xl items-center gap-3 px-3 md:gap-5 md:px-6">
        {/* Cover + title */}
        <div className="flex min-w-0 items-center gap-3" style={{ width: '30%' }}>
          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-[#1F1F1F]">
            {track?.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={track.coverUrl} alt={track.title} className="h-full w-full object-cover" />
            ) : (
              <div
                className="grid h-full w-full place-items-center text-base font-extrabold text-white"
                style={{ background: 'linear-gradient(135deg,#7B5EFF,#00F5E1)' }}
              >
                {(track?.title ?? 'P').charAt(0).toUpperCase()}
              </div>
            )}
            <span className="absolute right-1 top-1 h-1.5 w-1.5 animate-pulse rounded-full bg-[#00D4AA] shadow-[0_0_6px_#00D4AA]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-white">{track?.title ?? 'No track loaded'}</div>
            <div className="truncate text-xs text-[#B3B3B3]">{track?.artistName ?? 'Press play to start streaming'}</div>
            {track && (
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="badge-pay !text-[9px]">${rate.toFixed(4)} / stream</span>
              </div>
            )}
          </div>
          {track && (
            <button
              onClick={() => setLiked((v) => !v)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#B3B3B3] transition hover:text-white"
              aria-label="Like"
            >
              <Heart className={`h-4 w-4 ${liked ? 'fill-[#00D4AA] text-[#00D4AA]' : ''}`} />
            </button>
          )}
        </div>

        {/* Center: controls + progress with 25% marker */}
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.alert('Shuffle mode coming soon.');
                }
              }}
              className="grid h-7 w-7 place-items-center rounded-full text-[#B3B3B3] transition hover:text-white"
              aria-label="Shuffle"
            >
              <Shuffle className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onSkipPrev}
              className="grid h-8 w-8 place-items-center rounded-full text-white/85 transition hover:text-white"
              aria-label="Previous"
            >
              <SkipBack className="h-4 w-4 fill-current" />
            </button>
            <button
              onClick={onTogglePlay}
              className="grid h-10 w-10 place-items-center rounded-full bg-white text-black transition hover:scale-105"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
            </button>
            <button
              onClick={onSkipNext}
              className="grid h-8 w-8 place-items-center rounded-full text-white/85 transition hover:text-white"
              aria-label="Next"
            >
              <SkipForward className="h-4 w-4 fill-current" />
            </button>
            <button
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.alert('Repeat mode coming soon.');
                }
              }}
              className="grid h-7 w-7 place-items-center rounded-full text-[#B3B3B3] transition hover:text-white"
              aria-label="Repeat"
            >
              <Repeat className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex w-full max-w-xl items-center gap-2">
            <span className="w-10 text-right text-[10px] tabular-nums text-[#B3B3B3]">{elapsedStr}</span>
            <div className="relative h-1 flex-1 cursor-pointer rounded-full bg-white/10">
              {/* Filled progress */}
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-white"
                style={{ width: `${progress * 100}%` }}
              />
              {/* 25% threshold marker (Pazzera spec) */}
              <div
                className="absolute inset-y-0 w-0.5 rounded-full bg-[#F59E0B]"
                style={{ left: `${PAYMENT_THRESHOLD * 100}%` }}
                title="Payment threshold — 25% triggers USDC charge"
              />
              {/* Animated "triggered" highlight bar */}
              {triggered && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="absolute inset-y-0 w-0.5 rounded-full bg-[#10B981]"
                  style={{ left: `${PAYMENT_THRESHOLD * 100}%`, boxShadow: '0 0 8px #10B981' }}
                />
              )}
            </div>
            <span className="w-10 text-[10px] tabular-nums text-[#B3B3B3]">{durationStr}</span>
          </div>
        </div>

        {/* Right: live USDC ticker + volume */}
        <div className="flex items-center gap-3" style={{ width: '30%', justifyContent: 'flex-end' }}>
          <AnimatePresence>
            {triggered ? (
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', damping: 14, stiffness: 220 }}
                className="hidden items-center gap-1.5 rounded-full border border-[#10B981]/40 bg-[#10B981]/15 px-3 py-1.5 md:flex"
                title="USDC per stream charged at 25% mark"
              >
                <Zap className="h-3.5 w-3.5 fill-[#10B981] text-[#10B981]" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#10B981]">Paid</span>
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="hidden items-center gap-1.5 rounded-full border border-[#00D4AA]/30 bg-[#00D4AA]/10 px-3 py-1.5 md:flex"
                title="Listening — charge will trigger at 25% of the song"
              >
                <Sparkles className="h-3.5 w-3.5 text-[#00D4AA]" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#00D4AA]">Listening</span>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="hidden items-center gap-1.5 rounded-full border border-[#282828] bg-[#181818] px-3 py-1.5 md:flex">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#B3B3B3]">USDC</span>
            <motion.span
              key={accruedUsdc.toFixed(6)}
              initial={{ scale: 0.95, opacity: 0.7 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.15 }}
              className="text-sm font-bold tabular-nums text-white"
            >
              {accruedUsdc.toFixed(6)}
            </motion.span>
          </div>

          <button
            onClick={() => setMuted((v) => !v)}
            className="grid h-8 w-8 place-items-center rounded-full text-[#B3B3B3] transition hover:text-white"
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <div className="hidden h-1 w-24 rounded-full bg-white/10 md:block">
            <div
              className="h-1 rounded-full bg-white"
              style={{ width: `${muted ? 0 : volume * 100}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}