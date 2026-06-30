'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { Play, Pause, SkipBack, SkipForward, Volume2, Repeat, Shuffle, Repeat1, ListMusic } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePlayerQueue, type QueuedSong } from '@/lib/player-queue';
import {
  startRealtime,
  pause as socketPause,
  resume as socketResume,
  seek as socketSeek,
  end as socketEnd,
  disconnect as socketDisconnect,
  subscribePaymentDue,
  subscribePaymentSettled,
  subscribePaymentFailed,
  subscribeThresholdCrossed,
  subscribeAckTick,
  isConnected,
  getBufferedTickCount,
} from '@/lib/realtime-client';
import { WaveformProgress } from './waveform-progress';
import { cn } from '@/lib/cn';
import { motion as framer } from 'framer-motion';

interface ActiveTrack {
  songId: string;
  title: string;
  artist: string;
  coverUrl: string;
  durationSec: number;
  positionSec: number;
  pricePerStream: string;
  audioUrl: string;
  waveformPeaks?: { min: number[]; max: number[] } | null;
}

const PLACEHOLDER: ActiveTrack = {
  songId: '',
  title: 'Select something to play',
  artist: 'Pazzera',
  coverUrl: '',
  durationSec: 0,
  positionSec: 0,
  pricePerStream: '0.002',
  audioUrl: '',
};

const TICK_INTERVAL_MS = 250; // client-side visual tick (the socket ticks are server-driven at 5s)

/**
 * Phase 8 StickyPlayer — drives the audio element, plays the queue,
 * connects to Socket.IO for the server-authoritative stream session,
 * and renders the Phase 8 WaveformProgress.
 */
export function StickyPlayer() {
  const queue = usePlayerQueue();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [track, setTrack] = useState<ActiveTrack>(PLACEHOLDER);
  const [positionSec, setPositionSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.85);
  const [hidden, setHidden] = useState(typeof document !== 'undefined' ? document.visibilityState !== 'visible' : false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [thresholdReached, setThresholdReached] = useState(false);
  const [paymentDuePending, setPaymentDuePending] = useState<{ amount: string; nonce: string; streamId: string } | null>(null);
  const [paymentSettledFlash, setPaymentSettledFlash] = useState<{ txHash?: string } | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const bufferedRef = useRef(0);

  const current = queue.queue[queue.currentIndex] ?? null;

  // ─── Visibility tracking for socket tick payloads ─────────────
  useEffect(() => {
    const onVis = () => setHidden(document.visibilityState !== 'visible');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // ─── Local position ticker (250ms for smooth UI; socket ticks at 5s for the server) ───
  useEffect(() => {
    if (!playing) {
      if (tickerRef.current) { clearInterval(tickerRef.current); tickerRef.current = null; }
      return;
    }
    tickerRef.current = setInterval(() => {
      const a = audioRef.current;
      if (a) {
        setPositionSec(a.currentTime);
        if (a.ended) handleNext();
      }
    }, TICK_INTERVAL_MS);
    return () => { if (tickerRef.current) { clearInterval(tickerRef.current); tickerRef.current = null; } };
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Listen for "pazzera:play" events from song cards (Phase 5 contract) ─
  useEffect(() => {
    function onPlay(e: Event) {
      const ce = e as CustomEvent<{ song: Omit<QueuedSong, 'durationSeconds'> & { durationSeconds: number; pricePerStream: string } }>;
      const s = ce.detail.song;
      // Set the queue to this one song if empty
      if (queue.queue.length === 0) {
        queue.enqueue([s]);
      }
      // Find or set current
      const idx = queue.queue.findIndex((q) => q.id === s.id);
      if (idx >= 0) queue.jumpTo(idx);
      else queue.enqueueNext(s);
    }
    window.addEventListener('pazzera:play', onPlay as EventListener);
    return () => window.removeEventListener('pazzera:play', onPlay as EventListener);
  }, [queue]);

  // ─── When currentIndex changes, load + optionally play the audio ─────────
  useEffect(() => {
    if (!current) {
      setTrack(PLACEHOLDER);
      setPositionSec(0);
      setPlaying(false);
      return;
    }
    setTrack({
      songId: current.id,
      title: current.title,
      artist: current.artistName,
      coverUrl: current.coverUrl,
      durationSec: current.durationSeconds,
      positionSec: 0,
      pricePerStream: current.publishedPriceUsdc,
      audioUrl: current.audioUrl,
      waveformPeaks: current.waveformPeaks,
    });
    setPositionSec(0);
    setThresholdReached(false);
    const a = audioRef.current;
    if (a) {
      a.src = current.audioUrl;
      a.load();
      a.play().then(() => {
        setPlaying(true);
        // Connect realtime + start streaming session
        if (typeof window !== 'undefined' && (window as unknown as { __user?: { id: string } }).__user?.id) {
          void startRealtime({
            userId: (window as unknown as { __user: { id: string } }).__user.id,
            songId: current.id,
            durationSec: current.durationSeconds,
            isResume: false,
            playbackState: () => ({
              positionSec: a.currentTime,
              muted: a.muted,
              hidden: document.visibilityState !== 'visible',
              playbackRate: a.playbackRate,
              volume: a.volume,
              queuePosition: queue.currentIndex,
            }),
          });
        }
      }).catch(() => setPlaying(false));
    }
    return () => {
      // Don't auto-disconnect on song change — the realtime server will
      // see the previous stream as ended and clean up.
      void socketEnd();
    };
  }, [queue.currentIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Subscribe to socket events ────────────────────────────────────────
  useEffect(() => {
    const offDue = subscribePaymentDue((p) => {
      const v = p as { streamId: string; amountUsdc: string; nonce: string };
      setPaymentDuePending({ amount: v.amountUsdc, nonce: v.nonce, streamId: v.streamId });
    });
    const offSettled = subscribePaymentSettled((p) => {
      const v = p as { txHash?: string };
      setPaymentDuePending(null);
      setPaymentSettledFlash({ txHash: v.txHash });
      setThresholdReached(true);
      setTimeout(() => setPaymentSettledFlash(null), 3000);
    });
    const offFailed = subscribePaymentFailed(() => setPaymentDuePending(null));
    const offThreshold = subscribeThresholdCrossed(() => {
      setThresholdReached(true);
    });
    const offAck = subscribeAckTick((p) => {
      const v = p as { accumulatedMs: number; thresholdCrossed: boolean };
      if (v.thresholdCrossed) setThresholdReached(true);
    });
    return () => {
      offDue();
      offSettled();
      offFailed();
      offThreshold();
      offAck();
    };
  }, []);

  const togglePlay = useCallback(async () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
      await socketPause();
    } else {
      try {
        await a.play();
        setPlaying(true);
        await socketResume(() => ({
          positionSec: a.currentTime,
          muted: a.muted,
          hidden: document.visibilityState !== 'visible',
          playbackRate: a.playbackRate,
          volume: a.volume,
          queuePosition: queue.currentIndex,
        }));
      } catch {
        // ignore
      }
    }
  }, [playing, queue.currentIndex]);

  const handleSeek = useCallback(async (sec: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = sec;
    setPositionSec(sec);
    await socketSeek(Math.max(0, sec - 0.5), sec);
  }, []);

  const handleNext = useCallback(async () => {
    await socketEnd();
    const nextSong = queue.next();
    if (!nextSong) {
      setPlaying(false);
      await socketDisconnect();
    }
  }, [queue]);

  const handlePrev = useCallback(async () => {
    queue.prev();
  }, [queue]);

  // Update buffered count every second
  useEffect(() => {
    const id = setInterval(() => { bufferedRef.current = getBufferedTickCount(); }, 1_000);
    return () => clearInterval(id);
  }, []);

  // When the song ends naturally, advance the queue
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    function onEnded() { void handleNext(); }
    a.addEventListener('ended', onEnded);
    return () => a.removeEventListener('ended', onEnded);
  }, [handleNext]);

  return (
    <>
      <audio ref={audioRef} preload="metadata" muted={muted} />
      <span data-testid="song-id" className="sr-only">{track.songId}</span>
      <div
        className={cn(
          'pointer-events-auto fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/95 backdrop-blur-xl',
          'pb-[env(safe-area-inset-bottom)]',
          track.songId ? 'opacity-100' : 'pointer-events-none opacity-50',
        )}
      >
        <div className="mx-auto flex max-w-[1400px] items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4 md:py-3">
          <div className="hidden w-64 items-center gap-3 min-w-0 sm:flex">
            <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-md bg-bg-muted">
              {track.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={track.coverUrl} alt={track.title} className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full w-full place-items-center text-fg-muted text-xs">♪</div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <Link href={track.songId ? `/song/${track.songId}` : '#'} className="block truncate text-sm font-medium hover:underline">
                {track.title}
              </Link>
              <div className="truncate text-xs text-fg-muted">{track.artist}</div>
            </div>
          </div>

          {/* Center: controls + waveform */}
          <div className="flex flex-1 flex-col gap-1">
            <div className="flex items-center justify-center gap-1 sm:gap-2">
              <button
                onClick={() => setQueueOpen((v) => !v)}
                aria-label={queueOpen ? 'Close queue' : 'Open queue'}
                aria-expanded={queueOpen}
                data-testid="queue-toggle"
                className={cn(
                  'rounded-md p-1.5 text-fg-muted transition hover:text-fg md:hidden',
                  queueOpen && 'text-accent',
                )}
                title="Queue"
              >
                <ListMusic className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => queue.toggleShuffle()}
                aria-label="Shuffle"
                className={cn(
                  'rounded-md p-1.5 text-fg-muted transition hover:text-fg',
                  queue.shuffle && 'text-accent',
                )}
                title={queue.shuffle ? 'Shuffle on' : 'Shuffle off'}
              >
                <Shuffle className="h-3.5 w-3.5" />
              </button>
              <button onClick={handlePrev} aria-label="Previous" className="rounded-md p-1.5 text-fg hover:bg-bg-muted">
                <SkipBack className="h-4 w-4" />
              </button>
              <button
                onClick={togglePlay}
                disabled={!track.songId}
                aria-label={playing ? 'Pause' : 'Play'}
                className={cn(
                  'grid h-9 w-9 place-items-center rounded-full transition',
                  playing
                    ? 'bg-accent text-bg hover:bg-accent/90'
                    : 'bg-bg-muted text-fg hover:bg-fg/10',
                )}
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-0.5" />}
              </button>
              <button onClick={handleNext} aria-label="Next" className="rounded-md p-1.5 text-fg hover:bg-bg-muted">
                <SkipForward className="h-4 w-4" />
              </button>
              <button
                onClick={() => queue.cycleRepeat()}
                aria-label="Repeat"
                className={cn(
                  'rounded-md p-1.5 text-fg-muted transition hover:text-fg',
                  queue.repeat !== 'off' && 'text-accent',
                )}
                title={`Repeat: ${queue.repeat}`}
              >
                {queue.repeat === 'one' ? <Repeat1 className="h-3.5 w-3.5" /> : <Repeat className="h-3.5 w-3.5" />}
              </button>
            </div>

            {/* Waveform with payment trigger marker */}
            <WaveformProgress
              peaks={track.waveformPeaks}
              durationSec={track.durationSec}
              positionSec={positionSec}
              onSeek={track.songId ? handleSeek : undefined}
              thresholdReached={thresholdReached}
              compact
            />
          </div>

          {/* Right: volume + price */}
          <div className="flex w-44 items-center justify-end gap-3">
            {paymentDuePending && (
              <span
                data-testid="payment-due-toast"
                className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-2 py-0.5 text-[11px] text-accent border border-accent/30"
              >
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
                </span>
                Pay {paymentDuePending.amount}
              </span>
            )}
            {paymentSettledFlash && (
              <span
                data-testid="payment-settled-toast"
                className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-400 border border-emerald-400/30"
              >
                ✓ paid
              </span>
            )}
            <span className="text-[11px] tabular-nums text-fg-muted">
              {Math.floor(positionSec / 60)}:{(Math.floor(positionSec % 60)).toString().padStart(2, '0')} / {Math.floor(track.durationSec / 60)}:{(Math.floor(track.durationSec % 60)).toString().padStart(2, '0')}
            </span>
            <button
              onClick={() => { const a = audioRef.current; if (a) { a.muted = !a.muted; setMuted(a.muted); } }}
              aria-label="Mute"
              className="rounded-md p-1.5 text-fg-muted hover:text-fg"
            >
              <Volume2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Floating position badge when payment is due */}
      <AnimatePresence>
        {paymentDuePending && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-2xl border border-accent/40 bg-bg/95 px-4 py-2 shadow-2xl backdrop-blur"
          >
            <div className="flex items-center gap-2 text-sm">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
              </span>
              Payment due: {paymentDuePending.amount} USDC
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Queue drawer — mobile-friendly, slides up from the sticky player. */}
      <AnimatePresence>
        {queueOpen && (
          <motion.div
            key="queue-drawer"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 280 }}
            className="fixed inset-x-0 bottom-20 z-40 mx-auto max-h-[60vh] max-w-2xl overflow-hidden rounded-t-2xl border border-border bg-bg/95 backdrop-blur-xl"
            data-testid="queue-drawer"
            role="dialog"
            aria-label="Up next"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-medium">Up next ({queue.queue.length})</h3>
              <button
                onClick={() => setQueueOpen(false)}
                aria-label="Close queue"
                className="rounded-md p-1 text-fg-muted hover:text-fg"
              >
                ✕
              </button>
            </div>
            <div className="max-h-[50vh] overflow-y-auto px-2 py-2">
              {queue.queue.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-fg-muted">Queue is empty.</p>
              ) : (
                queue.queue.map((q, idx) => (
                  <div
                    key={`${q.id}-${idx}`}
                    className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-bg-muted"
                  >
                    <span className="w-6 text-center text-xs text-fg-muted">{idx + 1}</span>
                    <img
                      src={q.coverUrl ?? ''}
                      alt=""
                      className="h-9 w-9 flex-shrink-0 rounded object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{q.title}</p>
                      <p className="truncate text-xs text-fg-muted">{q.artistName}</p>
                    </div>
                    <button
                      onClick={() => {
                        queue.removeAt(idx);
                      }}
                      className="rounded p-1 text-xs text-fg-muted hover:text-danger"
                      aria-label="Remove from queue"
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
