'use client';
import { useEffect, useState } from 'react';
import { Save, Wallet, Shield, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';

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

export function ProfilePage() {
  const [data, setData] = useState<ProfileData | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [prefs, setPrefs] = useState({ emailNotifications: true, paymentToasts: true, fraudAlerts: true });

  useEffect(() => {
    fetch('/api/profile')
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setUsername(d.username);
        setDisplayName(d.displayName ?? '');
        setBio(d.bio ?? '');
        if (d.preferences) setPrefs(d.preferences);
      });
  }, []);

  if (!data) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setSaved(false);
    try {
      await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-csrf-token': getCookie('csrf') ?? '' },
        body: JSON.stringify({ username, displayName, bio, preferences: prefs }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-8 py-8 space-y-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
        <p className="text-fg-muted text-sm mt-1">Manage how you appear on Pazzera.</p>
      </header>

      <form onSubmit={save} className="space-y-6">
        <section className="rounded-2xl border border-border bg-bg-elevated p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Identity</h2>
            {data.isArtist && <Badge variant="accent">Artist</Badge>}
          </div>
          <div>
            <Label className="block mb-1.5">Username</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} minLength={3} maxLength={20} required />
            <p className="mt-1 text-xs text-fg-muted">3–20 characters, lowercase a–z, digits, underscore.</p>
          </div>
          <div>
            <Label className="block mb-1.5">Display name</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div>
            <Label className="block mb-1.5">Bio</Label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="flex min-h-[80px] w-full rounded-xl border border-border bg-bg-elevated px-4 py-2 text-sm text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Tell listeners a bit about you…"
            />
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-bg-elevated p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-accent" />
            <h2 className="text-lg font-semibold">Wallet custody</h2>
          </div>
          {data.wallet ? (
            <div className="rounded-xl border border-border bg-bg-elevated/50 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-fg-muted">Address</span>
                <code className="text-xs">{data.wallet.address.slice(0, 8)}…{data.wallet.address.slice(-6)}</code>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-fg-muted">Provider</span>
                <Badge variant="glass">{data.wallet.provider}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-fg-muted">Custody</span>
                <Badge variant={data.wallet.custody === 'user' ? 'success' : 'warning'}>
                  {data.wallet.custody === 'user' ? 'You (Circle UCW)' : 'Pazzera (dev mode)'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-fg-muted">Status</span>
                <Badge variant={data.wallet.status === 'active' ? 'success' : 'warning'}>{data.wallet.status}</Badge>
              </div>
            </div>
          ) : (
            <div className="text-sm text-fg-muted">No wallet yet. Complete sign-in to provision one.</div>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-bg-elevated p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-accent" />
            <h2 className="text-lg font-semibold">Notifications</h2>
          </div>
          <PrefRow
            label="Email notifications"
            desc="Receive sign-in alerts, account changes, and weekly summaries."
            checked={prefs.emailNotifications}
            onChange={(v) => setPrefs((p) => ({ ...p, emailNotifications: v }))}
          />
          <Separator />
          <PrefRow
            label="Payment toasts"
            desc="Show the live payment pulse when nano payments trigger on your streams."
            checked={prefs.paymentToasts}
            onChange={(v) => setPrefs((p) => ({ ...p, paymentToasts: v }))}
          />
          <Separator />
          <PrefRow
            label="Fraud alerts"
            desc="Get notified if suspicious activity is detected on your account."
            checked={prefs.fraudAlerts}
            onChange={(v) => setPrefs((p) => ({ ...p, fraudAlerts: v }))}
          />
        </section>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            <Save className="h-4 w-4 mr-2" /> {pending ? 'Saving…' : 'Save changes'}
          </Button>
          {saved && <span className="text-sm text-accent animate-fade-in">Saved.</span>}
        </div>
      </form>
    </div>
  );
}

function PrefRow({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-fg-muted">{desc}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name}=`));
  return m?.split('=')[1] ?? null;
}