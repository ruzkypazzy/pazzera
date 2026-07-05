'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Save, Wallet, Shield, Bell, Check, X, Camera } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { PazzeraLogo } from '@/components/logo';

interface ProfileData {
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  email: string;
  isArtist: boolean;
  role: string;
  wallet: { address: string; status: string; provider: string; custody: string } | null;
  preferences: { emailNotifications: boolean; paymentToasts: boolean; fraudAlerts: boolean };
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]!) : null;
}

export function ProfilePage() {
  const router = useRouter();
  const [data, setData] = useState<ProfileData | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState({ emailNotifications: true, paymentToasts: true, fraudAlerts: true });

  useEffect(() => {
    fetch('/api/profile')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          // Not authed — middleware should have redirected; if we got here, push to sign-in.
          router.push('/sign-in?next=/profile');
          return;
        }
        setData(d);
        setUsername(d.username);
        setDisplayName(d.displayName ?? '');
        setBio(d.bio ?? '');
        if (d.preferences) setPrefs(d.preferences);
      });
  }, [router]);

  if (!data) {
    return (
      <AppShell>
        <div className="mx-auto max-w-3xl px-4 py-12 text-center md:px-8">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-[#00D4AA] border-t-transparent" />
        </div>
      </AppShell>
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setSaved(false);
    setError(null);
    try {
      const csrf = getCookie('csrf') ?? '';
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrf,
        },
        body: JSON.stringify({
          username: username.trim(),
          displayName: displayName.trim() || null,
          bio: bio.trim() || null,
          preferences: prefs,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error?.message ?? 'Could not save profile. Please try again.');
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-8 md:px-8">
        <header className="flex items-center gap-4">
          <PazzeraLogo size={48} />
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#B3B3B3]">Your account</div>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white">Profile</h1>
          </div>
        </header>

        <form onSubmit={save} className="space-y-6">
          <section className="rounded-2xl border border-[#282828] bg-[#0F0F18] p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Identity</h2>
              {data.isArtist && (
                <span className="badge-agent">Artist</span>
              )}
            </div>

            {/* Avatar */}
            <div className="flex items-center gap-4">
              <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-full ring-2 ring-white/15" style={{ background: 'linear-gradient(135deg,#7B5EFF,#00F5E1)' }}>
                {data.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={data.avatarUrl} alt={data.displayName ?? data.username} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-2xl font-extrabold text-white">{(data.displayName ?? data.username).charAt(0).toUpperCase()}</span>
                )}
              </div>
              <div className="text-sm">
                <div className="font-semibold text-white">{data.displayName || `@${data.username}`}</div>
                <div className="text-xs text-[#B3B3B3]">{data.email}</div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="username" className="block text-xs font-semibold uppercase tracking-widest text-[#B3B3B3]">Username</label>
              <input
                id="username"
                className="input-square"
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/[^a-z0-9_]/gi, '').toLowerCase().slice(0, 20))}
                minLength={3}
                maxLength={20}
                required
              />
              <p className="text-[10px] text-[#6A6A6A]">3–20 characters · lowercase a–z, 0–9, underscore</p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="displayName" className="block text-xs font-semibold uppercase tracking-widest text-[#B3B3B3]">Display name</label>
              <input
                id="displayName"
                className="input-square"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="What should we call you?"
                maxLength={60}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="bio" className="block text-xs font-semibold uppercase tracking-widest text-[#B3B3B3]">Bio</label>
              <textarea
                id="bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Tell listeners a bit about you…"
                className="w-full rounded-2xl border border-[#282828] bg-[#0A0A0A] px-4 py-3 text-sm text-white placeholder:text-[#6A6A6A] outline-none focus:border-[#00D4AA] focus:bg-[#121212] focus:ring-2 focus:ring-[#00D4AA]/20"
              />
              <p className="text-right text-[10px] text-[#6A6A6A]">{bio.length}/500</p>
            </div>
          </section>

          <section className="rounded-2xl border border-[#282828] bg-[#0F0F18] p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-[#00D4AA]" />
              <h2 className="text-lg font-bold text-white">Notifications</h2>
            </div>
            <Toggle
              label="Email notifications"
              desc="Sign-in alerts, weekly summaries, account changes"
              checked={prefs.emailNotifications}
              onChange={(v) => setPrefs((p) => ({ ...p, emailNotifications: v }))}
            />
            <Toggle
              label="Payment toasts"
              desc="Show the live payment pulse when nano payments trigger"
              checked={prefs.paymentToasts}
              onChange={(v) => setPrefs((p) => ({ ...p, paymentToasts: v }))}
            />
            <Toggle
              label="Fraud alerts"
              desc="Get notified if suspicious activity is detected"
              checked={prefs.fraudAlerts}
              onChange={(v) => setPrefs((p) => ({ ...p, fraudAlerts: v }))}
            />
          </section>

          <section className="rounded-2xl border border-[#282828] bg-[#0F0F18] p-6 space-y-3">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-[#C7B9FF]" />
              <h2 className="text-lg font-bold text-white">Wallet custody</h2>
            </div>
            {data.wallet ? (
              <div className="rounded-xl border border-[#282828] bg-[#0A0A0A] p-4 text-sm">
                <div className="font-mono text-[#00D4AA]">{data.wallet.address}</div>
                <div className="mt-1 text-xs text-[#B3B3B3]">
                  Status: <span className="text-white">{data.wallet.status}</span> · Provider: <span className="text-white">{data.wallet.provider}</span> · Custody: <span className="text-white">{data.wallet.custody}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[#B3B3B3]">No wallet yet. Complete sign-in to provision one.</p>
            )}
          </section>

          {/* Save bar */}
          <div className="sticky bottom-32 z-20 flex items-center gap-3 rounded-2xl border border-[#282828] bg-[#0F0F18]/95 p-3 backdrop-blur-md">
            {error && (
              <div className="flex flex-1 items-center gap-2 text-sm text-[#FCA5A5]">
                <X className="h-4 w-4" />
                {error}
              </div>
            )}
            {saved && !error && (
              <div className="flex flex-1 items-center gap-2 text-sm text-[#00D4AA]">
                <Check className="h-4 w-4" />
                Profile saved.
              </div>
            )}
            {!error && !saved && (
              <div className="flex-1 text-xs text-[#6A6A6A]">Changes apply to your public Pazzera profile.</div>
            )}
            <button
              type="submit"
              disabled={pending}
              className="btn-primary disabled:opacity-50"
            >
              {pending ? 'Saving…' : (<><Save className="h-4 w-4" /> Save changes</>)}
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}

function Toggle({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-[#282828] bg-[#0A0A0A] p-4">
      <div>
        <div className="font-semibold text-white">{label}</div>
        <div className="text-xs text-[#B3B3B3]">{desc}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="relative h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 outline-none"
        style={{
          background: checked ? '#00D4AA' : '#3A3A3A',
        }}
      >
        <span
          className="pointer-events-none absolute top-1/2 block h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow transition-transform duration-200"
          style={{
            left: checked ? '22px' : '2px',
          }}
        />
      </button>
    </div>
  );
}