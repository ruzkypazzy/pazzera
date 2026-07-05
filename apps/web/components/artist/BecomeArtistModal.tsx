'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Music, ArrowRight, Loader2, Check } from 'lucide-react';

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * "Become an artist" modal — opens for signed-in listeners on the home page.
 * Collects artistic details and calls POST /api/auth/artist-upgrade.
 * On success, refreshes the page so the new artist-only nav/buttons appear.
 */
export function BecomeArtistModal({ open, onClose }: Props) {
  const router = useRouter();
  const [stage, setStage] = useState<'form' | 'submitting' | 'success'>('form');
  const [error, setError] = useState<string | null>(null);

  // Form fields
  const [stageName, setStageName] = useState('');
  const [genre, setGenre] = useState('');
  const [bio, setBio] = useState('');
  const [city, setCity] = useState('');

  function reset() {
    setStage('form');
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStage('submitting');
    try {
      const csrf = (() => {
        if (typeof document === 'undefined') return '';
        const m = document.cookie.match(/(?:^|; )csrf=([^;]*)/);
        return m ? decodeURIComponent(m[1]!) : '';
      })();
      const res = await fetch('/api/auth/artist-upgrade', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrf,
        },
        body: JSON.stringify({
          stageName: stageName.trim(),
          // API expects genres[]; map our single genre picker to the array.
          genres: genre.trim() ? [genre.trim()] : ['Unspecified'],
          // Combine bio + city so the backend's 20-char min is easily hit.
          bio: [bio.trim(), city.trim() && `From ${city.trim()}`].filter(Boolean).join(' ').slice(0, 1000) || 'New artist on Pazzera.',
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error?.message ?? 'Could not upgrade to artist. Please try again.');
        setStage('form');
        return;
      }
      setStage('success');
      // Refresh the page after a short delay so the new role propagates
      setTimeout(() => {
        onClose();
        router.refresh();
        router.push('/upload');
      }, 1400);
    } catch {
      setError('Network error. Please try again.');
      setStage('form');
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => {
              if (stage !== 'submitting') onClose();
            }}
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ duration: 0.22, type: 'spring', damping: 18, stiffness: 220 }}
            className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-[#282828] bg-[#0F0F18] shadow-2xl"
          >
            <button
              type="button"
              onClick={onClose}
              disabled={stage === 'submitting'}
              className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full bg-white/[0.06] text-white/60 transition hover:bg-white/[0.10] hover:text-white disabled:opacity-30"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>

            {stage === 'success' ? (
              <div className="p-10 text-center">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-full" style={{ background: 'linear-gradient(135deg,#7B5EFF,#00F5E1)' }}>
                  <Check className="h-8 w-8 text-white" />
                </div>
                <h2 className="mt-4 text-2xl font-extrabold text-white">Welcome, artist</h2>
                <p className="mt-2 text-sm text-[#B3B3B3]">Setting up your artist studio…</p>
              </div>
            ) : (
              <form onSubmit={submit} className="p-6 md:p-8">
                <div className="flex items-center gap-3">
                  <div className="grid h-12 w-12 place-items-center rounded-2xl" style={{ background: 'rgba(123,94,255,0.18)', color: '#C7B9FF' }}>
                    <Music className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-extrabold text-white">Become an artist</h2>
                    <p className="text-xs text-[#B3B3B3]">Upload tracks, set your price, and earn USDC per stream.</p>
                  </div>
                </div>

                <div className="mt-6 space-y-4">
                  <Field
                    label="Stage name"
                    desc="The name listeners will see on your tracks."
                    required
                  >
                    <input
                      className="input-square"
                      value={stageName}
                      onChange={(e) => setStageName(e.target.value)}
                      placeholder="DJ Vex"
                      maxLength={60}
                      required
                    />
                  </Field>
                  <Field label="Primary genre" required>
                    <input
                      className="input-square"
                      value={genre}
                      onChange={(e) => setGenre(e.target.value)}
                      placeholder="Electronic, Hip-Hop, Afrobeats, …"
                      maxLength={40}
                      required
                    />
                  </Field>
                  <Field label="Short bio">
                    <textarea
                      className="w-full rounded-2xl border border-[#282828] bg-[#0A0A0A] px-4 py-3 text-sm text-white placeholder:text-[#6A6A6A] outline-none focus:border-[#7B5EFF] focus:bg-[#121212] focus:ring-2 focus:ring-[#7B5EFF]/20"
                      rows={3}
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      placeholder="Tell listeners about your sound…"
                      maxLength={500}
                    />
                  </Field>
                  <Field label="City (optional)">
                    <input
                      className="input-square"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="Lagos, Berlin, Tokyo…"
                      maxLength={60}
                    />
                  </Field>
                </div>

                {error && (
                  <div className="mt-4 rounded-xl border border-[#EF4444]/30 bg-[#EF4444]/10 px-4 py-3 text-sm text-[#FCA5A5]">
                    {error}
                  </div>
                )}

                <div className="mt-6 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={stage === 'submitting'}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={stage === 'submitting'}
                    className="btn-primary flex items-center gap-2 disabled:opacity-50"
                    style={{ background: '#7B5EFF', color: 'white' }}
                  >
                    {stage === 'submitting' ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Upgrading…</>
                    ) : (
                      <>Upgrade to artist <ArrowRight className="h-4 w-4" /></>
                    )}
                  </button>
                </div>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
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
          {required && <span className="text-[#7B5EFF] normal-case">·</span>}
        </span>
        {children}
      </label>
      {desc && <p className="mt-1 text-[10px] text-[#6A6A6A]">{desc}</p>}
    </div>
  );
}