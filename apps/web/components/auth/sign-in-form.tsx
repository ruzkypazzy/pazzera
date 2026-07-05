'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Headphones, Music, ArrowRight } from 'lucide-react';

type Role = 'listener' | 'artist';

export function SignInForm({ initialEmail = '' }: { initialEmail?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const [role, setRole] = useState<Role>('listener');

  // Pull role from ?intent=artist query OR sessionStorage (set by chooser)
  useEffect(() => {
    const intent = params.get('intent');
    if (intent === 'artist') setRole('artist');
    if (typeof window !== 'undefined') {
      const stored = sessionStorage.getItem('pazzera:signin:role') as Role | null;
      if (stored === 'artist' || stored === 'listener') setRole(stored);
    }
  }, [params]);

  function switchRole(next: Role) {
    setRole(next);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('pazzera:signin:role', next);
    }
  }

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
      sessionStorage.setItem('pazzera:signin:role', role);
      const next = params.get('next') || '/home';
      router.push(`/verify?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* Role toggle */}
      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-[#282828] bg-[#0A0A0A] p-1.5">
        <RoleToggle
          active={role === 'listener'}
          onClick={() => switchRole('listener')}
          icon={<Headphones className="h-3.5 w-3.5" />}
          label="Listener"
        />
        <RoleToggle
          active={role === 'artist'}
          onClick={() => switchRole('artist')}
          icon={<Music className="h-3.5 w-3.5" />}
          label="Artist"
        />
      </div>

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
        {role === 'artist' && (
          <p className="text-[10px] text-[#7B5EFF]">
            You'll be signed up with an artist account — upload tracks, set your price, and earn USDC.
          </p>
        )}
        {role === 'listener' && (
          <p className="text-[10px] text-[#00D4AA]">
            You'll be signed up as a listener — pay artists directly in USDC as you stream.
          </p>
        )}
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-[#EF4444]/30 bg-[#EF4444]/10 px-4 py-3 text-sm text-[#FCA5A5]"
        >
          {error}
          {cooldown && (
            <span className="ml-1">Try again in {cooldown}s.</span>
          )}
        </div>
      )}
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={pending}
        style={{
          background: role === 'artist' ? '#7B5EFF' : '#00D4AA',
          color: role === 'artist' ? '#FFFFFF' : '#001815',
        }}
      >
        {pending ? 'Sending code…' : 'Send sign-in code'} <ArrowRight className="ml-1 h-4 w-4" />
      </Button>
      <p className="text-center text-xs text-[#B3B3B3]">
        We&apos;ll email you a 6-digit code. No password needed.
      </p>
      <div className="text-center text-[10px] text-[#6A6A6A]">
        New here?{' '}
        <Link href="/sign-up" className="text-[#00D4AA] hover:underline">
          Create an account
        </Link>
      </div>
    </form>
  );
}

function RoleToggle({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold uppercase tracking-wider transition"
      style={{
        background: active ? (label === 'Artist' ? '#7B5EFF' : '#00D4AA') : 'transparent',
        color: active ? (label === 'Artist' ? '#FFFFFF' : '#001815') : '#B3B3B3',
      }}
    >
      {icon}
      {label}
    </button>
  );
}