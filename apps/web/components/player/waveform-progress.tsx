'use client';
import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * WaveformProgress — Phase 8 mini waveform with the glowing green
 * payment-trigger marker at the 25% threshold.
 *
 * Reads waveform peaks (from Phase 6) and renders a Skia-style bar
 * chart the listener can scrub. The trigger marker is at the song's
 * thresholdSec position; it pulses to signal "payment will fire here."
 */
interface WaveformProgressProps {
  /** Normalized peaks [0..1] (min + max). */
  peaks?: { min: number[]; max: number[] } | null;
  durationSec: number;
  /** Where the listener currently is (seconds). */
  positionSec: number;
  /** Where the threshold crossing happens (default 25% of duration). */
  thresholdPct?: number;
  /** Optional progress-above-threshold signal (turns marker green once crossed). */
  thresholdReached?: boolean;
  /** Seek handler (gets called with seconds). */
  onSeek?: (sec: number) => void;
  /** Compact mode: tight 32px tall for sticky player. */
  compact?: boolean;
}

function formatTimecode(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function WaveformProgress({
  peaks,
  durationSec,
  positionSec,
  thresholdPct = 25,
  thresholdReached = false,
  onSeek,
  compact = false,
}: WaveformProgressProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      setWidth(containerRef.current?.clientWidth ?? 800);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const thresholdSec = (durationSec * thresholdPct) / 100;
  const thresholdPx = durationSec > 0 ? (thresholdSec / durationSec) * width : 0;
  const progressPx = durationSec > 0 ? (positionSec / durationSec) * width : 0;

  const peakData = useMemo(() => {
    if (!peaks || peaks.max.length === 0) {
      // Synthesize a placeholder peaks array (looks like a real audio)
      const bars = 96;
      return Array.from({ length: bars }, (_, i) => {
        const t = i / bars;
        const env = 0.4 + 0.3 * Math.sin(t * Math.PI * 4);
        const noise = Math.abs(Math.sin(i * 1.61803) * 0.2);
        return Math.max(0.05, Math.min(1, env + noise));
      });
    }
    const max = peaks.max;
    if (max.length > 96) {
      const step = Math.floor(max.length / 96);
      const out: number[] = [];
      for (let i = 0; i < 96; i++) out.push(max[i * step] ?? 0);
      return out;
    }
    return max;
  }, [peaks]);

  const barCount = 96;
  const barWidth = Math.max(1, (width - (barCount - 1) * 1.5) / barCount);

  const onPointer = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!onSeek || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const pct = x / rect.width;
    setHoverPct(pct);
    if (e.type === 'pointerdown' || e.buttons === 1) {
      onSeek(pct * durationSec);
    }
  }, [durationSec, onSeek]);

  return (
    <div
      ref={containerRef}
      role={onSeek ? 'slider' : undefined}
      aria-valuemin={0}
      aria-valuemax={durationSec}
      aria-valuenow={positionSec}
      aria-label="Playback position"
      onPointerDown={onPointer}
      onPointerMove={onPointer}
      onPointerLeave={() => setHoverPct(null)}
      className={cn(
        'relative w-full cursor-pointer select-none touch-none',
        compact ? 'h-8' : 'h-16',
      )}
    >
      {/* Waveform bars */}
      <div className="absolute inset-x-0 top-0 flex h-full items-center gap-[1.5px] pointer-events-none">
        {peakData.map((peak, i) => {
          const isPast = (i / barCount) * width <= progressPx;
          const heightPct = Math.max(10, peak * 100);
          return (
            <motion.div
              key={i}
              className="rounded-sm"
              style={{
                width: barWidth,
                height: `${heightPct}%`,
                background: isPast
                  ? 'linear-gradient(180deg, var(--accent), color-mix(in oklab, var(--accent) 60%, white))'
                  : 'color-mix(in oklab, var(--fg-muted) 40%, transparent)',
                boxShadow: isPast ? '0 0 6px color-mix(in oklab, var(--accent) 80%, transparent)' : undefined,
              }}
              animate={{ opacity: isPast ? 1 : 0.6 }}
            />
          );
        })}
      </div>

      {/* Hover tooltip */}
      {hoverPct !== null && (
        <div
          className="absolute -top-7 z-10 -translate-x-1/2 rounded-md bg-bg-elevated px-2 py-0.5 text-[10px] text-fg shadow-md border border-border"
          style={{ left: hoverPct * width }}
        >
          {Math.round(hoverPct * durationSec)}s
        </div>
      )}

      {/* Payment trigger marker (25% threshold) */}
      <div
        className="absolute top-0 h-full pointer-events-none"
        style={{ left: thresholdPx, width: 2, transform: 'translateX(-1px)' }}
      >
        <div className="relative h-full">
          {/* Green glow line */}
          <motion.div
            className={cn(
              'absolute inset-y-0 left-1/2 -translate-x-1/2 w-[3px] rounded-full',
              thresholdReached
                ? 'bg-emerald-400'
                : 'bg-emerald-400/60',
            )}
            animate={
              thresholdReached
                ? { opacity: 1, boxShadow: '0 0 12px rgba(74, 222, 128, 0.8)' }
                : {
                    opacity: [0.6, 1, 0.6],
                    boxShadow: [
                      '0 0 0px rgba(74, 222, 128, 0)',
                      '0 0 12px rgba(74, 222, 128, 0.6)',
                      '0 0 0px rgba(74, 222, 128, 0)',
                    ],
                  }
            }
            transition={
              thresholdReached
                ? { duration: 0.3 }
                : { repeat: Infinity, duration: 2, ease: 'easeInOut' }
            }
            style={{ width: 3 }}
          />
          {/* Spark icon at the top — visible only when above-threshold */}
          {thresholdReached && (
            <motion.div
              initial={{ y: -8, opacity: 0, scale: 0.6 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              className="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-full bg-emerald-500 text-white p-0.5 shadow-lg"
            >
              <Sparkles className="h-2.5 w-2.5" />
            </motion.div>
          )}
          {/* Label only in non-compact mode */}
          {!compact && (
            <div
              className={cn(
                'absolute top-full mt-0.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-medium',
                thresholdReached ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-400/30' : 'bg-bg-elevated text-emerald-400 border border-emerald-400/30',
              )}
            >
              {thresholdReached ? '✓ charged' : '⚡ pay'}
            </div>
          )}
        </div>
      </div>

      {/* Playhead */}
      <div
        className="absolute top-0 h-full pointer-events-none"
        style={{ left: progressPx, width: 2, transform: 'translateX(-1px)' }}
      >
        <div
          className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[2px] bg-accent"
          style={{ boxShadow: '0 0 6px var(--accent)' }}
        />
        <div
          className="absolute -top-1 left-1/2 -translate-x-1/2 h-2 w-2 rounded-full bg-accent"
          style={{ boxShadow: '0 0 6px var(--accent)' }}
        />
      </div>

      {/* Hover scrub preview line */}
      {hoverPct !== null && hoverPct * width !== progressPx && (
        <div
          className="absolute top-0 h-full w-px bg-fg-subtle/40 pointer-events-none"
          style={{ left: hoverPct * width, transform: 'translateX(-0.5px)' }}
        />
      )}

      {/* Hover time tooltip */}
      {hoverPct !== null && (
        <div
          className="absolute top-0 -translate-y-full -translate-x-1/2 rounded-md border border-border bg-bg/95 px-1.5 py-0.5 text-[10px] text-fg-muted shadow pointer-events-none"
          style={{ left: hoverPct * width }}
          aria-hidden="true"
        >
          {formatTimecode(hoverPct * durationSec)}
        </div>
      )}
    </div>
  );
}
