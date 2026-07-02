'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload as UploadIcon, Music, ImageIcon, DollarSign, Clock, Plus, X,
  Check, Loader2, AlertCircle, ArrowRight, Sparkles, Disc3,
  AtSign, Wallet, ExternalLink,
} from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { PazzeraLogo } from '@/components/logo';

type UploadState = 'idle' | 'uploading-audio' | 'uploading-cover' | 'submitting' | 'success' | 'error';

const MIN_PRICE = 0.001;
const MAX_PRICE = 0.005;
const PAYMENT_THRESHOLD = 0.25;
const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;
const WALLET_REGEX = /^0x[a-fA-F0-9]{40}$/;

type RecipientKind = 'internal' | 'external';
type RecipientRole = 'primary_artist' | 'featured_artist' | 'producer';

interface FormRecipient {
  /** Local row key — NOT sent to server. */
  key: string;
  kind: RecipientKind;
  role: RecipientRole;
  /** Pazzera @username (when kind='internal') */
  pazzeraUsername: string;
  /** Public-facing display name (credits) */
  displayName: string;
  /** External wallet address (when kind='external') */
  walletAddress: string;
  /** External wallet label */
  walletLabel: string;
  /** 0..100 — gets converted to bps at submit time */
  percentage: number;
}

function makeKey() {
  return Math.random().toString(36).slice(2, 10);
}

export default function UploadPage() {
  const router = useRouter();

  // Profile (for auto-fill)
  const [myUsername, setMyUsername] = useState('');
  const [myDisplayName, setMyDisplayName] = useState('');

  // Form state
  const [title, setTitle] = useState('');
  const [artistName, setArtistName] = useState('');
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

  // Recipients: primary artist is the first row and locked to the logged-in user.
  const [recipients, setRecipients] = useState<FormRecipient[]>([]);

  // Live-computed: payment trigger time = 25% of song duration
  const triggerSec = Math.ceil(durationSec * PAYMENT_THRESHOLD);
  const triggerLabel = durationSec
    ? `Payment begins at ${triggerSec}s (25% of ${durationSec}s)`
    : 'Add an audio file to see the 25% trigger';

  useEffect(() => {
    fetch('/api/profile')
      .then((r) => r.json())
      .then((d) => {
        if (d?.username) setMyUsername(d.username);
        if (d?.displayName) {
          setMyDisplayName(d.displayName);
          setArtistName(d.displayName);
        } else if (d?.username) {
          setMyDisplayName(d.username);
          setArtistName(d.username);
        }
      })
      .catch(() => undefined);
  }, []);

  // Initialize recipients once we know the artist's username.
  useEffect(() => {
    if (!myUsername) return;
    if (recipients.length > 0) return;
    setRecipients([
      {
        key: makeKey(),
        kind: 'internal',
        role: 'primary_artist',
        pazzeraUsername: myUsername,
        displayName: myDisplayName || myUsername,
        walletAddress: '',
        walletLabel: '',
        percentage: 70,
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUsername]);

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
      a.onerror = () => URL.revokeObjectURL(url);
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

  // ─── Recipient helpers ────────────────────────────────────────────
  function addRecipient(role: RecipientRole) {
    setRecipients((prev) => [
      ...prev,
      {
        key: makeKey(),
        kind: 'internal',
        role,
        pazzeraUsername: '',
        displayName: '',
        walletAddress: '',
        walletLabel: '',
        percentage: role === 'producer' ? 10 : 15,
      },
    ]);
  }

  function removeRecipient(key: string) {
    setRecipients((prev) => prev.filter((r) => r.key !== key));
  }

  function updateRecipient(key: string, patch: Partial<FormRecipient>) {
    setRecipients((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  }

  /** Total percentage across all non-primary recipients. */
  const secondaryTotal = useMemo(
    () =>
      recipients
        .filter((r) => r.role !== 'primary_artist')
        .reduce((s, r) => s + (Number.isFinite(r.percentage) ? r.percentage : 0), 0),
    [recipients],
  );
  const primaryPerc = 100 - secondaryTotal;

  // ─── Validation ───────────────────────────────────────────────────
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

    if (!myUsername) return 'Could not determine your Pazzera @username — sign out and back in';
    const primary = recipients.find((r) => r.role === 'primary_artist');
    if (!primary) return 'Primary artist row is missing';

    if (Math.abs(primaryPerc - primary.percentage) > 0.5) {
      return `Splits must add up to 100%. Featured + producer total is ${secondaryTotal}%, primary is ${primary.percentage}% — rebalance to match.`;
    }
    if (primary.percentage <= 0 || primary.percentage >= 100) {
      return 'Primary artist split must leave room for featured / producer (or they can be 0%)';
    }

    for (const r of recipients) {
      if (r.kind === 'internal') {
        if (!USERNAME_REGEX.test(r.pazzeraUsername)) {
          return `Pazzera @username must be 3–20 chars, lowercase a–z / 0–9 / _ (got "${r.pazzeraUsername}")`;
        }
      } else {
        if (!WALLET_REGEX.test(r.walletAddress)) {
          return `${r.role.replace('_', ' ')} wallet address must be a valid 0x address`;
        }
        if (!r.walletLabel.trim()) {
          return `${r.role.replace('_', ' ')} external label is required`;
        }
      }
      if (!r.displayName.trim()) {
        return `${r.role.replace('_', ' ')} display name is required`;
      }
      if (!Number.isFinite(r.percentage) || r.percentage < 0 || r.percentage > 100) {
        return `${r.role.replace('_', ' ')} percentage must be 0–100`;
      }
    }

    // Featured + producer dedupe
    const seenKeys = new Set<string>();
    for (const r of recipients) {
      if (r.role === 'primary_artist') continue;
      const k = r.kind === 'internal' ? r.pazzeraUsername.toLowerCase() : r.walletAddress.toLowerCase();
      if (seenKeys.has(k)) return `Duplicate recipient: ${r.kind === 'internal' ? '@' + r.pazzeraUsername : r.walletAddress}`;
      seenKeys.add(k);
    }

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

      const featured = recipients.filter((r) => r.role === 'featured_artist');
      const producerRow = recipients.find((r) => r.role === 'producer');
      const primary = recipients.find((r) => r.role === 'primary_artist')!;

      const featuredNames: string[] = featured.map((r) => r.displayName);
      const producerName: string | null = producerRow?.displayName?.trim() || null;

      const apiRecipients = [
        {
          type: 'internal' as const,
          username: primary.pazzeraUsername,
          displayName: primary.displayName,
          role: 'primary_artist' as const,
          percentageBps: Math.round(primary.percentage * 100),
        },
        ...featured.map((r) => ({
          type: r.kind,
          username: r.kind === 'internal' ? r.pazzeraUsername : r.walletAddress,
          displayName: r.displayName,
          role: 'featured_artist' as const,
          percentageBps: Math.round(r.percentage * 100),
          ...(r.kind === 'external'
            ? { externalWalletAddress: r.walletAddress, externalLabel: r.walletLabel }
            : {}),
        })),
        ...(producerRow
          ? [
              {
                type: producerRow.kind,
                username: producerRow.kind === 'internal' ? producerRow.pazzeraUsername : producerRow.walletAddress,
                displayName: producerRow.displayName,
                role: 'producer' as const,
                percentageBps: Math.round(producerRow.percentage * 100),
                ...(producerRow.kind === 'external'
                  ? {
                      externalWalletAddress: producerRow.walletAddress,
                      externalLabel: producerRow.walletLabel,
                    }
                  : {}),
              },
            ]
          : []),
      ];

      const csrf = getCookie('csrf');
      const res = await fetch('/api/upload/finalize', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrf,
        },
        body: JSON.stringify({
          songId: uploadedSongId,
          priceUsdc: priceUsdc.toString(),
          metadata: {
            title: title.trim(),
            artistName: artistName.trim(),
            featuredNames,
            producerName,
            description: description.trim(),
            durationSeconds: durationSec,
            audioKey: aKey,
            coverKey: cKey,
          },
          recipients: apiRecipients,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message ?? 'Could not finalize upload');
      }
      setUploadedSongId(json.songId ?? json.id ?? null);
      setProgress(100);
      setState('success');
      setTimeout(() => router.push(`/song/${json.songId ?? json.id ?? ''}`), 1200);
    } catch (err) {
      setError((err as Error).message);
      setState('error');
    }
  }

  // Step before finalize: create the song draft so finalize has an `songId`.
  useEffect(() => {
    if (state !== 'idle') return;
    if (uploadedSongId) return;
    if (!title.trim()) return;
    fetch('/api/songs/create-draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': getCookie('csrf') },
      body: JSON.stringify({ title: title.trim(), description: description.trim() || undefined }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.id) setUploadedSongId(j.id);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-6 pb-32">
        <header>
          <div className="flex items-center gap-3">
            <PazzeraLogo size={36} />
            <h1 className="text-2xl font-extrabold tracking-tight text-white md:text-3xl">
              Upload a track
            </h1>
          </div>
          <p className="mt-1 text-sm text-[#B3B3B3]">
            Push audio to Pazzera and start earning USDC per stream.
          </p>
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
            <h2 className="text-sm font-bold uppercase tracking-widest text-[#B3B3B3]">
              Song details
            </h2>

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

            <Field
              label="Artist display name"
              desc="Shown publicly on the song page (defaults to your profile display name)."
              required
            >
              <input
                className="input-square"
                value={artistName}
                onChange={(e) => setArtistName(e.target.value)}
                placeholder="Stage name"
                maxLength={60}
                required
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
              <p className="text-right text-[10px] text-[#6A6A6A]">
                {description.length}/1000 · 20 char min
              </p>
            </Field>
          </section>

          {/* === Pricing & duration === */}
          <section className="card space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-widest text-[#B3B3B3]">
              Pricing &amp; duration
            </h2>

            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="Duration"
                desc="Auto-detected from the audio file. You can override if needed."
              >
                <div className="flex items-center gap-2">
                  <input
                    className="input-square"
                    type="number"
                    min={1}
                    max={3600}
                    value={durationSec || ''}
                    onChange={(e) => setDurationSec(Math.max(0, Number(e.target.value)))}
                  />
                  <span className="text-sm text-[#B3B3B3]">seconds</span>
                </div>
                {audioDuration > 0 && (
                  <p className="text-[10px] text-[#6A6A6A]">
                    Detected: {formatTime(audioDuration)}
                  </p>
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
                <p className="text-[10px] text-[#6A6A6A]">
                  Track must be priced within Pazzera's allowed band.
                </p>
              </Field>
            </div>

            {/* === 25% trigger box (always shown) === */}
            <div className="rounded-2xl border border-[#F59E0B]/30 bg-[#1A1408] p-4">
              <div className="flex items-center gap-2 text-[#F59E0B]">
                <Sparkles className="h-4 w-4" />
                <span className="text-[10px] font-bold uppercase tracking-widest">
                  Payment trigger
                </span>
              </div>
              <div className="mt-2 text-lg font-extrabold text-white">
                {durationSec > 0 ? (
                  <>
                    At <span className="text-[#F59E0B]">{triggerSec}s</span> of {durationSec}s
                  </>
                ) : (
                  <span className="text-[#B3B3B3] text-sm">Add duration to see the trigger</span>
                )}
              </div>
              <p className="mt-1 text-xs text-[#B3B3B3]">
                {durationSec > 0 ? (
                  <>
                    Once a listener hits the 25% mark, Pazzera charges{' '}
                    <strong>${priceUsdc.toFixed(4)} USDC</strong> for the stream. The listener
                    can keep listening to the rest of the track for free. Re-listening = a new
                    charge at the next 25% mark.
                  </>
                ) : (
                  triggerLabel
                )}
              </p>
            </div>
          </section>

          {/* === Credits & royalties === */}
          <section className="card space-y-5">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-[#B3B3B3]">
                Credits &amp; royalty split
              </h2>
              <p className="mt-1 text-xs text-[#B3B3B3]">
                Splits must add up to 100%. Each recipient gets a public display
                name plus a Pazzera <span className="font-bold text-white">@username</span>{' '}
                (which must exist on Pazzera to receive payouts) OR an external
                wallet address.
              </p>
            </div>

            {/* Primary artist (locked) */}
            {recipients
              .filter((r) => r.role === 'primary_artist')
              .map((r) => (
                <div
                  key={r.key}
                  className="rounded-2xl border border-[#00D4AA]/30 bg-[#00D4AA]/5 p-4"
                >
                  <div className="flex items-center gap-2 text-[#00D4AA]">
                    <Disc3 className="h-4 w-4" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">
                      Primary artist (you)
                    </span>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-[#B3B3B3]">
                        Pazzera @username
                      </label>
                      <div className="flex items-center gap-2 rounded-2xl border border-[#282828] bg-[#0A0A0A] px-3 py-2">
                        <AtSign className="h-3.5 w-3.5 text-[#6A6A6A]" />
                        <span className="text-sm text-white">{r.pazzeraUsername || '…'}</span>
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-[#B3B3B3]">
                        Display name
                      </label>
                      <input
                        className="input-square"
                        value={r.displayName}
                        onChange={(e) =>
                          updateRecipient(r.key, { displayName: e.target.value })
                        }
                        maxLength={60}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-[#B3B3B3]">
                        Split %
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          className="input-square"
                          type="number"
                          min={0}
                          max={100}
                          step={0.5}
                          value={r.percentage}
                          onChange={(e) =>
                            updateRecipient(r.key, {
                              percentage: Math.max(0, Math.min(100, Number(e.target.value))),
                            })
                          }
                        />
                        <span className="text-sm text-[#B3B3B3]">%</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

            {/* Featured artists */}
            <CreditGroup
              title="Featured artists"
              desc="Add a featured artist for every collab on the track."
              rows={recipients.filter((r) => r.role === 'featured_artist')}
              onAdd={() => addRecipient('featured_artist')}
              onRemove={removeRecipient}
              onUpdate={updateRecipient}
              otherTotal={secondaryTotal}
              thisTotalKey="featured_artist"
            />

            {/* Producer */}
            <CreditGroup
              title="Producer"
              desc="One producer per track. Leave empty if self-produced."
              rows={recipients.filter((r) => r.role === 'producer')}
              onAdd={() => addRecipient('producer')}
              onRemove={removeRecipient}
              onUpdate={updateRecipient}
              otherTotal={secondaryTotal}
              thisTotalKey="producer"
              single
            />

            {/* Split sanity meter */}
            <div
              className={`flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm ${
                Math.round(
                  (recipients.find((r) => r.role === 'primary_artist')?.percentage ?? 0) +
                    secondaryTotal,
                ) === 100
                  ? 'border-[#10B981]/30 bg-[#10B981]/10 text-[#6EE7B7]'
                  : 'border-[#EF4444]/30 bg-[#EF4444]/10 text-[#FCA5A5]'
              }`}
            >
              <Check
                className={`h-4 w-4 ${
                  Math.round(
                    (recipients.find((r) => r.role === 'primary_artist')?.percentage ?? 0) +
                      secondaryTotal,
                  ) === 100
                    ? 'text-[#10B981]'
                    : 'text-[#EF4444]'
                }`}
              />
              <span>
                Splits total:{' '}
                <span className="font-bold tabular-nums text-white">
                  {Math.round(
                    (recipients.find((r) => r.role === 'primary_artist')?.percentage ?? 0) +
                      secondaryTotal,
                  )}
                  %
                </span>{' '}
                — must equal 100%.
              </span>
            </div>
          </section>

          {/* === Submit === */}
          {error && (
            <div className="flex items-center gap-2 rounded-2xl border border-[#EF4444]/30 bg-[#EF4444]/10 px-4 py-3 text-sm text-[#FCA5A5]">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          <div className="sticky bottom-0 -mx-4 border-t border-[#282828] bg-[#0A0A0A]/95 px-4 py-4 backdrop-blur md:mx-0 md:rounded-2xl md:border md:px-6">
            <div className="flex items-center gap-3">
              <div className="hidden flex-1 items-center gap-2 md:flex">
                {progress > 0 && progress < 100 && (
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#282828]">
                    <div
                      className="h-full bg-[#00D4AA] transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                )}
                <span className="text-[10px] uppercase tracking-widest text-[#B3B3B3]">
                  {stepLabel(state)}
                </span>
              </div>
              <button
                type="button"
                className="rounded-full border border-[#282828] px-5 py-3 text-sm font-semibold text-[#B3B3B3] hover:border-[#3E3E3E] hover:text-white"
                onClick={() => router.back()}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  state === 'submitting' ||
                  state === 'uploading-audio' ||
                  state === 'uploading-cover' ||
                  state === 'success'
                }
                className="btn-primary flex items-center gap-2 disabled:opacity-60"
              >
                {state === 'submitting' || state === 'uploading-audio' || state === 'uploading-cover' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {stepLabel(state)}
                  </>
                ) : (
                  <>
                    Submit for curator review
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </AppShell>
  );
}

function stepLabel(state: UploadState) {
  switch (state) {
    case 'idle':
      return 'Ready';
    case 'uploading-audio':
      return 'Uploading audio…';
    case 'uploading-cover':
      return 'Uploading cover…';
    case 'submitting':
      return 'Finalising…';
    case 'success':
      return 'Submitted';
    case 'error':
      return 'Error';
  }
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/* ============================================================================
 * Credit group — repeatable card for featured artists or producers
 * ========================================================================= */
function CreditGroup({
  title,
  desc,
  rows,
  onAdd,
  onRemove,
  onUpdate,
  otherTotal,
  thisTotalKey,
  single,
}: {
  title: string;
  desc: string;
  rows: FormRecipient[];
  onAdd: () => void;
  onRemove: (key: string) => void;
  onUpdate: (key: string, patch: Partial<FormRecipient>) => void;
  otherTotal: number;
  thisTotalKey: string;
  single?: boolean;
}) {
  const thisTotal = rows.reduce((s, r) => s + (Number.isFinite(r.percentage) ? r.percentage : 0), 0);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-white">{title}</h3>
          <p className="text-[10px] text-[#6A6A6A]">{desc}</p>
        </div>
        {!single && (
          <button
            type="button"
            onClick={onAdd}
            className="flex items-center gap-1 rounded-full border border-[#282828] bg-[#0A0A0A] px-3 py-1.5 text-[11px] font-semibold text-white hover:border-[#00D4AA] hover:text-[#00D4AA]"
          >
            <Plus className="h-3.5 w-3.5" />
            Add {title.toLowerCase().replace(/s$/, '')}
          </button>
        )}
      </div>

      {rows.length === 0 && (
        <button
          type="button"
          onClick={onAdd}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[#282828] bg-[#0A0A0A] px-4 py-4 text-[12px] text-[#6A6A6A] hover:border-[#00D4AA] hover:text-[#00D4AA]"
        >
          <Plus className="h-3.5 w-3.5" />
          {single ? `Add ${title.toLowerCase()}` : `Add a ${title.toLowerCase().replace(/s$/, '')}`}
        </button>
      )}

      {rows.map((r) => (
        <CreditRow
          key={r.key}
          row={r}
          onChange={(patch) => onUpdate(r.key, patch)}
          onRemove={() => onRemove(r.key)}
        />
      ))}

      {rows.length > 0 && (
        <p className="text-right text-[10px] text-[#6A6A6A]">
          {title} total:{' '}
          <span className="font-bold tabular-nums text-white">
            {Math.round(thisTotal)}%
          </span>
        </p>
      )}
    </div>
  );
}

function CreditRow({
  row,
  onChange,
  onRemove,
}: {
  row: FormRecipient;
  onChange: (patch: Partial<FormRecipient>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-[#282828] bg-[#0A0A0A] p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onChange({ kind: 'internal' })}
            className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold ${
              row.kind === 'internal'
                ? 'border border-[#00D4AA] bg-[#00D4AA]/10 text-[#00D4AA]'
                : 'border border-[#282828] text-[#B3B3B3]'
            }`}
          >
            <AtSign className="h-3 w-3" />
            Pazzera user
          </button>
          <button
            type="button"
            onClick={() => onChange({ kind: 'external' })}
            className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold ${
              row.kind === 'external'
                ? 'border border-[#7B5EFF] bg-[#7B5EFF]/10 text-[#C7B9FF]'
                : 'border border-[#282828] text-[#B3B3B3]'
            }`}
          >
            <Wallet className="h-3 w-3" />
            External wallet
          </button>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="grid h-7 w-7 place-items-center rounded-full text-[#6A6A6A] hover:bg-[#EF4444]/15 hover:text-[#FCA5A5]"
          aria-label="Remove recipient"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-12">
        <div className="md:col-span-5">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-[#B3B3B3]">
            {row.kind === 'internal' ? 'Pazzera @username' : 'Wallet address'}
          </label>
          {row.kind === 'internal' ? (
            <div className="flex items-center gap-2 rounded-2xl border border-[#282828] bg-[#050505] px-3 py-2 focus-within:border-[#00D4AA]">
              <AtSign className="h-3.5 w-3.5 text-[#6A6A6A]" />
              <input
                className="w-full bg-transparent text-sm text-white placeholder:text-[#6A6A6A] outline-none"
                value={row.pazzeraUsername}
                onChange={(e) =>
                  onChange({
                    pazzeraUsername: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''),
                  })
                }
                placeholder="adazy"
                maxLength={20}
              />
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-2xl border border-[#282828] bg-[#050505] px-3 py-2 focus-within:border-[#7B5EFF]">
              <Wallet className="h-3.5 w-3.5 text-[#6A6A6A]" />
              <input
                className="w-full bg-transparent text-sm text-white placeholder:text-[#6A6A6A] outline-none"
                value={row.walletAddress}
                onChange={(e) => onChange({ walletAddress: e.target.value.trim() })}
                placeholder="0x…"
                maxLength={42}
              />
            </div>
          )}
        </div>

        <div className="md:col-span-5">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-[#B3B3B3]">
            Display name
          </label>
          <input
            className="input-square"
            value={row.displayName}
            onChange={(e) => onChange({ displayName: e.target.value })}
            placeholder={
              row.role === 'featured_artist'
                ? 'Featured artist name'
                : row.role === 'producer'
                  ? 'Producer credit'
                  : 'Artist name'
            }
            maxLength={60}
          />
        </div>

        <div className="md:col-span-2">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-[#B3B3B3]">
            Split %
          </label>
          <div className="flex items-center gap-1">
            <input
              className="input-square"
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={row.percentage}
              onChange={(e) =>
                onChange({
                  percentage: Math.max(0, Math.min(100, Number(e.target.value))),
                })
              }
            />
            <span className="text-sm text-[#B3B3B3]">%</span>
          </div>
        </div>
      </div>

      {row.kind === 'external' && (
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-[#B3B3B3]">
            External label <span className="normal-case text-[#6A6A6A]">(who is this wallet?)</span>
          </label>
          <input
            className="input-square"
            value={row.walletLabel}
            onChange={(e) => onChange({ walletLabel: e.target.value })}
            placeholder="e.g. ACME Records — accounting@acme.com"
            maxLength={80}
          />
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * Form helpers
 * ========================================================================= */
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
      <span className="mb-1 block text-xs font-semibold uppercase tracking-widest text-[#B3B3B3]">
        {label}
      </span>
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
        <span className="text-sm font-semibold text-white">
          {file ? file.name : `Choose ${label.toLowerCase()}`}
        </span>
        <span className="text-[10px] text-[#6A6A6A]">{desc}</span>
        <input
          id={inputId}
          type="file"
          accept={accept}
          className="hidden"
          onChange={onChange}
        />
      </label>
    </div>
  );
}
