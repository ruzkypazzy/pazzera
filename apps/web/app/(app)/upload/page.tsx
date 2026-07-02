'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload as UploadIcon, Music, ImageIcon, DollarSign, Clock, Plus, X,
  Check, Loader2, AlertCircle, ArrowRight, Sparkles, Disc3,
} from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { PazzeraLogo } from '@/components/logo';

type UploadState = 'idle' | 'uploading-audio' | 'uploading-cover' | 'submitting' | 'success' | 'error';

const MIN_PRICE = 0.001;
const MAX_PRICE = 0.005;
const PAYMENT_THRESHOLD = 0.25;

export default function UploadPage() {
  const router = useRouter();

  // Form state
  const [title, setTitle] = useState('');
  const [artistName, setArtistName] = useState('');
  const [featuredRaw, setFeaturedRaw] = useState(''); // comma-separated
  const [producerName, setProducerName] = useState('');
  const [description, setDescription] = useState('');
  const [durationSec, setDurationSec] = useState<number>(0);
  const [priceUsdc, setPriceUsdc] = useState<number>(0.003);

  // Files
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [audioDuration, setAudioDuration] = useState<number>(0);

  // UI state
  const [state, setState] = useState<UploadState>('idle');
  const [progress, setProgress] = useState<number>(0); // 0..100
  const [error, setError] = useState<string | null>(null);
  const [uploadedSongId, setUploadedSongId] = useState<string | null>(null);
  const [audioKey, setAudioKey] = useState<string | null>(null);
  const [coverKey, setCoverKey] = useState<string | null>(null);

  // Auto-detect artist name from the user's profile on mount
  useEffect(() => {
    fetch('/api/profile')
      .then((r) => r.json())
      .then((d) => {
        if (d?.displayName) setArtistName(d.displayName);
        else if (d?.username) setArtistName(d.username);
      })
      .catch(() => undefined);
  }, []);

  // Parse featured list (comma separated, trim, dedupe, drop empty)
  const featuredNames = useMemo(
    () => Array.from(new Set(featuredRaw.split(',').map((s) => s.trim()).filter(Boolean))),
    [featuredRaw],
  );

  // Live-computed: payment trigger time = 25% of song duration
  const triggerSec = Math.ceil(durationSec * PAYMENT_THRESHOLD);
  const triggerLabel = durationSec
    ? `Payment begins at ${triggerSec}s (25% of ${durationSec}s)`
    : 'Add an audio file to see the 25% trigger';

  function getCookie(name: string): string {
    if (typeof document === 'undefined') return '';
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]!) : '';
  }

  function pickAudio(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setAudioFile(f);
    setError(null);
    setAudioKey(null);
    if (f) {
      // Try to detect duration via <audio> element
      const url = URL.createObjectURL(f);
      const a = new Audio();
      a.preload = 'metadata';
      a.onloadedmetadata = () => {
        if (Number.isFinite(a.duration) && a.duration > 0) {
          setAudioDuration(Math.round(a.duration));
          setDurationSec(Math.round(a.duration));
        }
        URL.revokeObjectURL(url);
      };
      a.onerror = () => {
        URL.revokeObjectURL(url);
      };
      a.src = url;
    } else {
      setAudioDuration(0);
      setDurationSec(0);
    }
  }

  function pickCover(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setCoverFile(f);
    setError(null);
    setCoverKey(null);
  }

  async function uploadOne(file: File, kind: 'audio' | 'cover'): Promise<string> {
    const fd = new FormData();
    fd.append('file', file);
    const url = kind === 'audio' ? '/api/upload/audio' : '/api/upload/cover';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-csrf-token': getCookie('csrf') },
      body: fd,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message ?? `Could not upload ${kind}`);
    return json.key as string;
  }

  function validate(): string | null {
    if (!title.trim()) return 'Song title is required';
    if (!artistName.trim()) return 'Artist name is required';
    if (!description.trim() || description.trim().length < 20)
      return 'Description must be at least 20 characters';
    if (!audioFile) return 'Audio file is required';
    if (!coverFile) return 'Cover art is required';
    if (priceUsdc < MIN_PRICE || priceUsdc > MAX_PRICE)
      return `Price must be between ${MIN_PRICE} and ${MAX_PRICE} USDC per stream`;
    if (durationSec <= 0) return 'Could not detect audio duration — please pick a different file';
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    try {
      // Step 1: upload audio
      setState('uploading-audio');
      setProgress(15);
      const aKey = await uploadOne(audioFile!, 'audio');
      setAudioKey(aKey);
      setProgress(50);

      // Step 2: upload cover
      setState('uploading-cover');
      const cKey = await uploadOne(coverFile!, 'cover');
      setCoverKey(cKey);
      setProgress(80);

      // Step 3: finalize the song
      setState('submitting');
      const recipients = [
        { type: 'internal', username: artistName.trim(), role: 'primary_artist', percentageBps: 7000 },
        ...featuredNames.map((name) => ({
          type: 'internal',
          username: name,
          role: 'featured_artist',
          percentageBps: Math.floor(2000 / Math.max(1, featuredNames.length)),
        })),
        ...(producerName.trim()
          ? [{ type: 'internal', username: producerName.trim(), role: 'producer', percentageBps: 1000 }]
          : []),
      ];
      // Clamp to 10000 bps (100%)
      const total = recipients.reduce((s, r) => s + r.percentageBps, 0);
      if (total > 10000 && recipients[0]) {
        recipients[0].percentageBps -= total - 10000;
      }

      const csrf = getCookie('csrf');
      const res = await fetch('/api/upload/finalize', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrf,
        },
        body: JSON.stringify({
          title: title.trim(),
          artistName: artistName.trim(),
          featuredNames,
          producerName: producerName.trim() || null,
          description: description.trim(),
          durationSeconds: durationSec,
          audioKey: aKey,
          coverKey: cKey,
          artistPriceUsdc: priceUsdc.toString(),
          recipients,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message ?? 'Could not finalize upload');
      }
      setUploadedSongId(json.songId ?? json.id ?? null);
      setProgress(100);
      setState('success');
      // Refresh + redirect to the new song
      setTimeout(() => router.push(`/song/${json.songId ?? ''}`), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setState('error');
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-6 md:px-8">
        <header className="flex items-center gap-4">
          <PazzeraLogo size={48} />
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#B3B3B3]">For artists</div>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white">Upload a track</h1>
            <p className="mt-1 text-sm text-[#B3B3B3]">Push audio to Pazzera and start earning USDC per stream.</p>
          </div>
        </header>

        <form onSubmit={submit} className="space-y-6">
          {/* === Audio + Cover === */}
          <div className="grid gap-4 md:grid-cols-2">
            <FileField
              label="Audio file"
              desc="WAV, FLAC, MP3 — up to 100 MB"
              accept="audio/*"
              file={audioFile}
              onChange={pickAudio}
              icon={<Music className="h-6 w-6" />}
              accent="#00D4AA"
            />
            <FileField
              label="Cover art"
              desc="Square, 3000×3000 recommended"
              accept="image/*"
              file={coverFile}
              onChange={pickCover}
              icon={<ImageIcon className="h-6 w-6" />}
              accent="#7B5EFF"
            />
          </div>

          {/* === Song metadata === */}
          <section className="card space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-widest text-[#B3B3B3]">Song details</h2>

            <Field label="Song title" required>
              <input
                className="input-square"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="My new track"
                maxLength={120}
                required
              />
            </Field>

            <Field label="Artist name" desc="Defaults to your display name." required>
              <input
                className="input-square"
                value={artistName}
                onChange={(e) => setArtistName(e.target.value)}
                placeholder="Stage name"
                maxLength={60}
                required
              />
            </Field>

            <Field label="Featured artists" desc="Comma-separated. They'll be credited on the song page.">
              <input
                className="input-square"
                value={featuredRaw}
                onChange={(e) => setFeaturedRaw(e.target.value)}
                placeholder="Beyoncé, J Hus, Tems"
                maxLength={240}
              />
            </Field>

            <Field label="Producer name">
              <input
                className="input-square"
                value={producerName}
                onChange={(e) => setProducerName(e.target.value)}
                placeholder="Metro Boomin"
                maxLength={60}
              />
            </Field>

            <Field label="Description" required>
              <textarea
                className="w-full rounded-2xl border border-[#282828] bg-[#0A0A0A] px-4 py-3 text-sm text-white placeholder:text-[#6A6A6A] outline-none focus:border-[#00D4AA] focus:bg-[#121212] focus:ring-2 focus:ring-[#00D4AA]/20"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What's the story behind the track? Inspirations, vibe, what to expect…"
                maxLength={1000}
                required
              />
              <p className="text-right text-[10px] text-[#6A6A6A]">{description.length}/1000 · 20 char min</p>
            </Field>
          </section>

          {/* === Duration + Price === */}
          <section className="card space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-widest text-[#B3B3B3]">Pricing &amp; duration</h2>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Duration" desc="Auto-detected from the audio file. You can override if needed.">
                <div className="flex items-center gap-2">
                  <input
                    className="input-square"
                    type="number"
                    min={1}
                    max={3600}
                    value={durationSec || ''}
                    onChange={(e) => setDurationSec(Math.max(0, Number(e.target.value)))}
                    placeholder="0"
                  />
                  <span className="text-sm text-[#B3B3B3]">seconds</span>
                </div>
                {audioDuration > 0 && (
                  <p className="text-[10px] text-[#6A6A6A]">Detected: {formatTime(audioDuration)}</p>
                )}
              </Field>

              <Field
                label={`Price per stream (USDC) · ${MIN_PRICE}–${MAX_PRICE}`}
                desc="One charge per stream, fired the first time the listener hits 25%."
                required
              >
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-[#00D4AA]" />
                  <input
                    className="input-square"
                    type="number"
                    step={0.0001}
                    min={MIN_PRICE}
                    max={MAX_PRICE}
                    value={priceUsdc}
                    onChange={(e) => setPriceUsdc(Math.max(0, Number(e.target.value)))}
                    required
                  />
                  <span className="text-sm text-[#B3B3B3]">USDC / stream</span>
                </div>
                <p className="text-[10px] text-[#6A6A6A]">Track must be priced within Pazzera's allowed band.</p>
              </Field>
            </div>

            {/* === 25% trigger box (always shown) === */}
            <div className="rounded-2xl border border-[#F59E0B]/30 bg-[#1A1408] p-4">
              <div className="flex items-center gap-2 text-[#F59E0B]">
                <Sparkles className="h-4 w-4" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Payment trigger</span>
              </div>
              <div className="mt-2 text-lg font-extrabold text-white">
                {durationSec > 0 ? (
                  <>At <span className="text-[#F59E0B]">{triggerSec}s</span> of {durationSec}s</>
                ) : (
                  <span className="text-[#B3B3B3] text-sm">Add duration to see the trigger</span>
                )}
              </div>
              <p className="mt-1 text-xs text-[#B3B3B3]">
                {durationSec > 0 ? (
                  <>
                    Once a listener hits the 25% mark, Pazzera charges <strong>${priceUsdc.toFixed(4)} USDC</strong> for the stream.
                    The listener can keep listening to the rest of the track for free.
                    Re-listening = a new charge at the next 25% mark.
                  </>
                ) : (
                  triggerLabel
                )}
              </p>
            </div>
          </section>

          {/* === Submit === */}
          {error && (
            <div className="flex items-center gap-2 rounded-2xl border border-[#EF4444]/30 bg-[#EF4444]/10 px-4 py-3 text-sm text-[#FCA5A5]">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          {state === 'success' && (
            <div className="flex items-center gap-2 rounded-2xl border border-[#00D4AA]/30 bg-[#00D4AA]/10 px-4 py-3 text-sm text-[#00D4AA]">
              <Check className="h-4 w-4" />
              Uploaded! Sending you to your new track…
            </div>
          )}

          <div className="sticky bottom-32 z-20 flex items-center gap-2 rounded-2xl border border-[#282828] bg-[#0F0F18]/95 p-3 backdrop-blur-md">
            {state !== 'idle' && state !== 'success' && (
              <div className="flex-1">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full bg-gradient-to-r from-[#00D4AA] to-[#00F5E1] transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-[#B3B3B3]">{stateLabel(state)}</p>
              </div>
            )}
            {state === 'idle' && (
              <div className="flex-1 text-xs text-[#6A6A6A]">Submitting will queue your track for curator review.</div>
            )}
            {state === 'success' && <div className="flex-1" />}
            <Link href="/home"><button type="button" className="btn-secondary">Cancel</button></Link>
            <button
              type="submit"
              disabled={state !== 'idle' && state !== 'error'}
              className="btn-primary flex items-center gap-2 disabled:opacity-50"
            >
              {state === 'submitting' || state === 'uploading-audio' || state === 'uploading-cover' ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Uploading…</>
              ) : state === 'success' ? (
                <><Check className="h-4 w-4" /> Done</>
              ) : (
                <>Submit for curator review <ArrowRight className="h-4 w-4" /></>
              )}
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}

function stateLabel(s: UploadState): string {
  switch (s) {
    case 'uploading-audio': return 'Uploading audio…';
    case 'uploading-cover': return 'Uploading cover art…';
    case 'submitting': return 'Finalising…';
    case 'success': return 'Done!';
    case 'error': return 'Error';
    default: return '';
  }
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function Field({
  label,
  desc,
  required,
  children,
}: {
  label: string;
  desc?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block">
        <span className="mb-1 flex items-baseline gap-1.5 text-xs font-semibold uppercase tracking-widest text-[#B3B3B3]">
          {label}
          {required && <span className="text-[#00D4AA] normal-case">*</span>}
        </span>
        {children}
      </label>
      {desc && <p className="mt-1 text-[10px] text-[#6A6A6A]">{desc}</p>}
    </div>
  );
}

function FileField({
  label,
  desc,
  accept,
  file,
  onChange,
  icon,
  accent,
}: {
  label: string;
  desc: string;
  accept: string;
  file: File | null;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  icon: React.ReactNode;
  accent: string;
}) {
  const inputId = `file-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-widest text-[#B3B3B3]">{label}</span>
      <label
        htmlFor={inputId}
        className="group relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed bg-[#0A0A0A] px-4 py-6 text-center transition hover:border-solid"
        style={{ borderColor: file ? accent : 'rgba(255,255,255,0.15)' }}
      >
        <div
          className="grid h-10 w-10 place-items-center rounded-xl transition"
          style={{ background: `${accent}18`, color: accent }}
        >
          {icon}
        </div>
        {file ? (
          <>
            <div className="text-sm font-semibold text-white">{file.name}</div>
            <div className="text-[10px] text-[#B3B3B3]">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-widest" style={{ color: accent }}>
              Click to replace
            </div>
          </>
        ) : (
          <>
            <div className="text-sm font-semibold text-white">Drop or tap to choose</div>
            <div className="text-[10px] text-[#6A6A6A]">{desc}</div>
          </>
        )}
        <input
          id={inputId}
          type="file"
          accept={accept}
          onChange={onChange}
          className="sr-only"
        />
      </label>
    </div>
  );
}