'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Repeat, Shuffle, Heart, Sparkles, Zap } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useCurrentTrack, type CurrentTrack } from '@/lib/current-track';
import {
  startRealtime,
  end as realtimeEnd,
  pause as realtimePause,
  resume as realtimeResume,
  disconnect as realtimeDisconnect,
  subscribePaymentDue,
  subscribePaymentSettled,
  subscribePaymentFailed,
} from '@/lib/realtime-client';

export type Track = {
  id: string;
  title: string;
  artistName: string;
  artistId?: string;
  coverUrl?: string | null;
  durationSec: number;
  ratePerStreamUsdc: number; // e.g. 0.003
  audioUrl?: string;
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
// Badge states driven by real payment_settled / payment_failed events
// from the realtime server. 'idle' = before due, 'pending' = payment_due
// arrived but not yet settled/failed, 'settled' = paid, 'failed' = error.
type PaymentBadgeState = 'idle' | 'pending' | 'settled' | 'failed';

export function PlayerBar({
  track: trackProp,
  isPlaying: isPlayingProp = false,
  onTogglePlay: onTogglePlayProp,
  onSkipNext,
  onSkipPrev,
  paymentTriggered,
}: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [progress, setProgress] = useState(0); // 0..1
  const [elapsedSecState, setElapsedSecState] = useState(0); // seconds, updated by polling
  const [volume, setVolume] = useState(0.7);
  const [muted, setMuted] = useState(false);
  const [liked, setLiked] = useState(false);
  const [internalIsPlaying, setInternalIsPlaying] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [paymentBadge, setPaymentBadge] = useState<PaymentBadgeState>('idle');
  // The server-signed settlement path emits one pair of events per
  // stream. We key off streamId so swapping tracks in the queue resets
  // the badge until the new track's payment events arrive.
  const paymentStreamIdRef = useRef<string | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pull from global current-track store. If a `track` prop is also
  // passed, prefer it (for backwards compat), but the store is the
  // source of truth for the layout-level PlayerBar.
  const storeTrack = useCurrentTrack((s) => s.track);
  const setStoreTrack = useCurrentTrack((s) => s.setTrack);
  const storeIsPlaying = useCurrentTrack((s) => s.isPlaying);
  const setStoreIsPlaying = useCurrentTrack((s) => s.setIsPlaying);

  // Resolve the current user ID once. Used as the listener identity
  // when starting the realtime stream (so the Fan Agent knows who's
  // listening). If not signed in, realtime is a no-op.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/session', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        if (d?.authenticated && d?.user?.id) {
          setCurrentUserId(d.user.id);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to the realtime payment events. The server emits
  // payment_due / payment_settled / payment_failed for the active
  // stream. We update the badge from these events, not from local
  // progress. When the track changes we reset to 'idle' until the
  // new stream's events arrive.
  useEffect(() => {
    const offDue = subscribePaymentDue((p) => {
      const v = p as { streamId?: string };
      if (v?.streamId && paymentStreamIdRef.current && v.streamId !== paymentStreamIdRef.current) return;
      if (v?.streamId) paymentStreamIdRef.current = v.streamId;
      setPaymentBadge('pending');
    });
    const offSettled = subscribePaymentSettled((p) => {
      const v = p as { streamId?: string };
      if (v?.streamId && paymentStreamIdRef.current && v.streamId !== paymentStreamIdRef.current) return;
      if (v?.streamId) paymentStreamIdRef.current = v.streamId;
      setPaymentBadge('settled');
    });
    const offFailed = subscribePaymentFailed((p) => {
      const v = p as { streamId?: string };
      if (v?.streamId && paymentStreamIdRef.current && v.streamId !== paymentStreamIdRef.current) return;
      if (v?.streamId) paymentStreamIdRef.current = v.streamId;
      setPaymentBadge('failed');
    });
    return () => {
      offDue();
      offSettled();
      offFailed();
    };
  }, []);

  // The displayed track — prop wins over store (prop is for legacy AppShell)
  const track = trackProp ?? storeTrack;
  const playing = isPlayingProp || storeIsPlaying || internalIsPlaying;

  // Reset the badge when the displayed track changes.
  useEffect(() => {
    paymentStreamIdRef.current = null;
    setPaymentBadge('idle');
  }, [track?.id]);

  // Best-known duration for the current track in seconds, used as a
  // fallback when the <audio> element doesn't have metadata yet.
  const trackDurationSec =
    (track as any)?.durationSec ??
    (track as any)?.durationSeconds ??
    0;

  // Listen for "pazzera:play" events dispatched from song pages / cards.
  // Detail shape: { id, title, artistName, coverUrl, audioUrl,
  // durationSeconds, publishedPriceUsdc }.
  useEffect(() => {
    function onPlay(e: Event) {
      const ce = e as CustomEvent<{
        id?: string;
        slug?: string;
        title?: string;
        artistName?: string;
        artistUsername?: string;
        coverUrl?: string;
        audioUrl?: string;
        durationSeconds?: number;
        publishedPriceUsdc?: string;
      }>;
      const s = ce.detail;
      if (!s || !s.audioUrl || !s.id) return;
      // Update the global store so the bar shows this track.
      setStoreTrack({
        id: s.id,
        slug: s.slug ?? s.id,
        title: s.title ?? 'Unknown',
        artistName: s.artistName ?? 'Unknown',
        artistUsername: s.artistUsername ?? '',
        coverUrl: s.coverUrl ?? '',
        audioUrl: s.audioUrl,
        durationSeconds: s.durationSeconds ?? 0,
        publishedPriceUsdc: s.publishedPriceUsdc ?? '0.002',
      });
      const a = audioRef.current;
      if (!a) return;
      if (a.src && a.src.endsWith(s.audioUrl)) {
        a.play().then(() => setInternalIsPlaying(true)).catch(() => {});
        return;
      }
      a.src = s.audioUrl;
      a.load();
      a.play()
        .then(() => { setInternalIsPlaying(true); setStoreIsPlaying(true); })
        .catch((err) => {
          console.warn('[PlayerBar] play() rejected:', err);
          setInternalIsPlaying(false);
          setStoreIsPlaying(false);
        });
    }
    window.addEventListener('pazzera:play', onPlay as EventListener);
    return () => window.removeEventListener('pazzera:play', onPlay as EventListener);
  }, [setStoreTrack, setStoreIsPlaying]);

  // When track prop changes externally, swap the audio source
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !track?.audioUrl) return;
    if (a.src && a.src.endsWith(track.audioUrl)) return;
    a.src = track.audioUrl;
    a.load();
    if (isPlayingProp) {
      a.play().then(() => setInternalIsPlaying(true)).catch(() => {});
    }
  }, [track?.id, track?.audioUrl, isPlayingProp]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync audio element with play/pause prop (controlled mode)
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (isPlayingProp) {
      a.play().then(() => { setInternalIsPlaying(true); setStoreIsPlaying(true); }).catch(() => {});
    } else {
      a.pause();
      setInternalIsPlaying(false);
      setStoreIsPlaying(false);
    }
  }, [isPlayingProp, setStoreIsPlaying]);

  // Volume + mute sync
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.volume = muted ? 0 : volume;
  }, [volume, muted]);

  // Real progress driven by <audio> timeupdate
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    function onTime() {
      const a = audioRef.current;
      if (!a) return;
      const dur = a.duration;
      if (Number.isFinite(dur) && dur > 0) {
        setProgress(Math.min(1, a.currentTime / dur));
      }
    }
    function onPlay() {
      setInternalIsPlaying(true);
      setStoreIsPlaying(true);
      // Tell the realtime server a stream is starting so the Fan
      // Agent can run end-of-stream and either charge the listener
      // or skip the charge (self-play). Best-effort; we don't block
      // audio on this.
      if (currentUserId && track?.id) {
        const a = audioRef.current;
        const dur = (a && Number.isFinite(a.duration) ? a.duration : trackDurationSec) || 0;
        void startRealtime({
          userId: currentUserId,
          songId: track.id,
          durationSec: dur,
          isResume: false,
          playbackState: () => ({
            positionSec: a?.currentTime ?? 0,
            muted: a?.muted ?? false,
            hidden: typeof document !== 'undefined' && document.visibilityState !== 'visible',
            playbackRate: a?.playbackRate ?? 1,
            volume: a?.volume ?? 1,
            queuePosition: 0,
          }),
        });
      }
    }
    function onPause() {
      setInternalIsPlaying(false);
      setStoreIsPlaying(false);
      void realtimePause();
    }
    function onEnded() {
      setInternalIsPlaying(false);
      setStoreIsPlaying(false);
      setProgress(1);
      // End the realtime stream so the Fan Agent runs and decides on
      // payment / playCount increment.
      void realtimeEnd();
    }
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('durationchange', onTime);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('ended', onEnded);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('durationchange', onTime);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('ended', onEnded);
    };
  }, [setStoreIsPlaying, currentUserId, track?.id, trackDurationSec]);

  // Reset progress when track changes

  // Reset progress when track changes
  useEffect(() => {
    setProgress(0);
    setElapsedSecState(0);
  }, [track?.id]);

  // Polling fallback for the elapsed time display. `timeupdate` events
  // fire at most every ~250ms in some browsers (and can be throttled
  // further when the tab is in the background), which makes the
  // seconds counter look frozen. A 100ms polling loop reads
  // `a.currentTime` directly so the UI always reflects actual playback
  // time.
  useEffect(() => {
    const id = setInterval(() => {
      const a = audioRef.current;
      if (!a) return;
      const t = a.currentTime;
      const d = a.duration;
      if (Number.isFinite(t) && t >= 0) {
        // Update displayed elapsed time directly (independent of the
        // `progress` ratio, which is used for the bar width).
        setElapsedSecState(t);
        if (Number.isFinite(d) && d > 0) {
          setProgress(Math.min(1, t / d));
        }
      }
    }, 100);
    return () => clearInterval(id);
  }, []);

  // Use real duration when audio is loaded, else fall back to track duration.
  const [realDuration, setRealDuration] = useState<number | null>(null);
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    function onDur() {
      const a = audioRef.current;
      if (a && Number.isFinite(a.duration) && a.duration > 0) {
        setRealDuration(a.duration);
      }
    }
    a.addEventListener('durationchange', onDur);
    a.addEventListener('loadedmetadata', onDur);
    return () => {
      a.removeEventListener('durationchange', onDur);
      a.removeEventListener('loadedmetadata', onDur);
    };
  }, []);

  // `trackDurationSec` is declared earlier (line ~88) so the audio
  // event listener effect can use it. Just compute the real-duration
  // view here.
  const effectiveDurationSec = realDuration ?? trackDurationSec;

  const rate =
    (track as any)?.ratePerStreamUsdc ??
    Number((track as any)?.publishedPriceUsdc ?? 0.003);
  const elapsedSec = elapsedSecState;
  // The progress-bar threshold marker is purely visual (where the
  // 25% line is drawn). The actual 'Paid' badge in the corner is
  // driven exclusively by the realtime payment_settled event
  // (state `paymentBadge`), NOT by local progress — the user
  // explicitly asked for this in Fix 5.
  const elapsedStr = formatTime(elapsedSec);
  const durationStr = formatTime(effectiveDurationSec);

  // Toggle handler — drives the actual <audio> element
  const handleTogglePlay = () => {
    const a = audioRef.current;
    if (!a) {
      onTogglePlayProp?.();
      return;
    }
    if (a.paused) {
      // If we have no src yet, try to load from the current track
      // (either prop or store). The store is the source of truth for
      // the layout-level PlayerBar.
      const audioUrl = track?.audioUrl ?? storeTrack?.audioUrl;
      if (!a.src && audioUrl) {
        a.src = audioUrl;
        a.load();
      }
      // Still no src? Nothing to play.
      if (!a.src) {
        console.warn('[PlayerBar] play() with no audio src — pick a song first.');
        onTogglePlayProp?.();
        return;
      }
      a.play()
        .then(() => { setInternalIsPlaying(true); setStoreIsPlaying(true); })
        .catch((err) => {
          console.warn('[PlayerBar] play() rejected:', err);
          setInternalIsPlaying(false);
          setStoreIsPlaying(false);
        });
    } else {
      a.pause();
      setInternalIsPlaying(false);
      setStoreIsPlaying(false);
    }
    onTogglePlayProp?.();
  };

  return (
    <>
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
              onClick={handleTogglePlay}
              className="grid h-10 w-10 place-items-center rounded-full bg-white text-black transition hover:scale-105"
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
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
            </div>
            <span className="w-10 text-[10px] tabular-nums text-[#B3B3B3]">{durationStr}</span>
          </div>
        </div>

        {/* Right: live USDC ticker + volume */}
        <div className="flex items-center gap-3" style={{ width: '30%', justifyContent: 'flex-end' }}>
          <AnimatePresence mode="wait">
            {paymentBadge === 'settled' ? (
              <motion.div
                key="paid"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', damping: 14, stiffness: 220 }}
                className="hidden items-center gap-1.5 rounded-full border border-[#10B981]/40 bg-[#10B981]/15 px-3 py-1.5 md:flex"
                title="USDC per stream settled on Arc"
              >
                <Zap className="h-3.5 w-3.5 fill-[#10B981] text-[#10B981]" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#10B981]">Paid</span>
              </motion.div>
            ) : paymentBadge === 'pending' ? (
              <motion.div
                key="pending"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="hidden items-center gap-1.5 rounded-full border border-[#F59E0B]/40 bg-[#F59E0B]/10 px-3 py-1.5 md:flex"
                title="Payment due — settling on Arc"
              >
                <Sparkles className="h-3.5 w-3.5 text-[#F59E0B]" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#F59E0B]">Settling</span>
              </motion.div>
            ) : paymentBadge === 'failed' ? (
              <motion.div
                key="failed"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="hidden items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1.5 md:flex"
                title="Settlement failed"
              >
                <Zap className="h-3.5 w-3.5 text-red-400" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-red-400">Failed</span>
              </motion.div>
            ) : (
              <motion.div
                key="listening"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="hidden items-center gap-1.5 rounded-full border border-[#00D4AA]/30 bg-[#00D4AA]/10 px-3 py-1.5 md:flex"
                title="Listening — charge will trigger at 25% of the song"
              >
                <Sparkles className="h-3.5 w-3.5 text-[#00D4AA]" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#00D4AA]">Listening</span>
              </motion.div>
            )}
          </AnimatePresence>

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
    {/* The actual <audio> element driving playback */}
    <audio ref={audioRef} preload="metadata" />
  </>
  );
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}