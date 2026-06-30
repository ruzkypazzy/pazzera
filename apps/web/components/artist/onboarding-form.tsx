'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ArtistOnboardingForm() {
  const router = useRouter();
  const [stageName, setStageName] = useState('');
  const [bio, setBio] = useState('');
  const [genres, setGenres] = useState('house,electronic');
  const [twitter, setTwitter] = useState('');
  const [website, setWebsite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch('/api/auth/artist-upgrade', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': getCookie('csrf') ?? '' },
        body: JSON.stringify({
          stageName,
          bio,
          genres: genres.split(',').map((g) => g.trim()).filter(Boolean),
          socialLinks: {
            ...(twitter ? { twitter } : {}),
            ...(website ? { website } : {}),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Could not submit');
      } else {
        router.push('/artist');
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label className="block mb-1.5">Stage name</Label>
        <Input value={stageName} onChange={(e) => setStageName(e.target.value)} placeholder="Ada Lovelace" required />
      </div>
      <div>
        <Label className="block mb-1.5">Bio</Label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          required
          minLength={20}
          className="flex min-h-[100px] w-full rounded-xl border border-border bg-bg-elevated px-4 py-2 text-sm text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Tell us about your sound…"
        />
      </div>
      <div>
        <Label className="block mb-1.5">Genres (comma-separated)</Label>
        <Input value={genres} onChange={(e) => setGenres(e.target.value)} required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="block mb-1.5">Twitter / X (optional)</Label>
          <Input type="url" value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="https://x.com/…" />
        </div>
        <div>
          <Label className="block mb-1.5">Website (optional)</Label>
          <Input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
        </div>
      </div>
      {error && <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Submitting…' : 'Submit application'}
      </Button>
      <p className="text-xs text-fg-muted text-center">
        Admin review is automatic for the hackathon demo. You&apos;ll be approved instantly.
      </p>
    </form>
  );
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name}=`));
  return m?.split('=')[1] ?? null;
}