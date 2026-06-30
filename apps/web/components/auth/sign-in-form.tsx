'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function SignInForm({ initialEmail = '' }: { initialEmail?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCooldown(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address');
      return;
    }
    startTransition(async () => {
      const res = await fetch('/api/auth/request-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.error?.code === 'RATE_LIMITED') {
          const sec = data?.error?.message?.match?.(/(\d+)/)?.[1];
          setCooldown(sec ? Number(sec) : 60);
          setError('Too many requests. Please wait before trying again.');
        } else {
          setError(data?.error?.message ?? 'Could not send code. Please try again.');
        }
        return;
      }
      // Persist for the verify screen
      sessionStorage.setItem('pazzera:signin:email', email);
      router.push(`/verify?email=${encodeURIComponent(email)}`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
        >
          {error}
          {cooldown && (
            <span className="ml-1">Try again in {cooldown}s.</span>
          )}
        </div>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Sending code…' : 'Send sign-in code'}
      </Button>
      <p className="text-center text-xs text-fg-muted">
        We&apos;ll email you a 6-digit code. No password needed.
      </p>
    </form>
  );
}