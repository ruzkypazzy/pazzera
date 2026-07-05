'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function VerifyOtpForm({ email }: { email: string }) {
  const router = useRouter();
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [username, setUsername] = useState<string>(() => {
    // Pre-fill from the local part of the email so the user only has to edit.
    if (typeof window === 'undefined') return '';
    const stored = sessionStorage.getItem('pazzera:signin:email');
    const src = stored ?? email;
    const local = src.split('@')[0] ?? '';
    return local.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [resendCooldown, setResendCooldown] = useState(30);
  const [verifying, setVerifying] = useState(false);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  // Auto-submit when all 6 digits filled
  useEffect(() => {
    if (code.every((c) => c !== '')) {
      submit(code.join(''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code.join('')]);

  // Resend cooldown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  function setDigit(i: number, v: string) {
    const ch = v.replace(/\D/g, '').slice(0, 1);
    const next = [...code];
    next[i] = ch;
    setCode(next);
    if (ch && i < 5) inputs.current[i + 1]?.focus();
  }

  function onKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !code[i] && i > 0) {
      inputs.current[i - 1]?.focus();
    }
  }

  function onPaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (text.length === 6) {
      e.preventDefault();
      setCode(text.split(''));
    }
  }

  function submit(fullCode: string) {
    setError(null);
    setVerifying(true);
    // Read the role the user picked during sign-in (default to listener)
    const role = (typeof window !== 'undefined'
      ? (sessionStorage.getItem('pazzera:signin:role') as 'listener' | 'artist' | null)
      : null) || 'listener';
    // Send the chosen username; server validates and falls back if invalid.
    const chosenUsername = username.trim().toLowerCase() || undefined;
    startTransition(async () => {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, code: fullCode, role, username: chosenUsername }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error?.message ?? 'Invalid code. Please try again.');
        setCode(['', '', '', '', '', '']);
        inputs.current[0]?.focus();
        setVerifying(false);
        return;
      }
      // Show "provisioning wallet" state briefly for new users, then go to dashboard
      if (data.walletStatus === 'pending_provisioning') {
        sessionStorage.setItem('pazzera:welcome:newUser', '1');
      }
      // Clear role from sessionStorage (consumed)
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('pazzera:signin:role');
      }
      const next = new URLSearchParams(window.location.search).get('next') || '/home';
      router.push(next);
      router.refresh();
    });
  }

  function resend() {
    if (resendCooldown > 0) return;
    setResendCooldown(30);
    fetch('/api/auth/request-otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    }).catch(() => undefined);
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-fg-muted">
          We sent a 6-digit code to{' '}
          <span className="font-medium text-fg">{email}</span>. The code expires in 10 minutes.
        </p>
      </div>

      {/* Username — picked now so a new user gets a real handle on day one */}
      <div className="space-y-1.5">
        <label htmlFor="pazzera-username" className="block text-xs font-semibold uppercase tracking-widest text-[#B3B3B3]">
          Choose a username
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-[#6A6A6A]">@</span>
          <input
            id="pazzera-username"
            className="input-square !pl-8"
            value={username}
            onChange={(e) => setUsername(e.target.value.replace(/[^a-z0-9_]/gi, '').toLowerCase().slice(0, 20))}
            placeholder="yourhandle"
            minLength={3}
            maxLength={20}
            required
            autoComplete="username"
          />
        </div>
        <p className="text-[10px] text-[#6A6A6A]">3–20 characters · lowercase a–z, 0–9, underscore</p>
      </div>
      <div className="flex justify-center gap-2" onPaste={onPaste}>
        {code.map((c, i) => (
          <input
            key={i}
            ref={(el) => {
              inputs.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={c}
            onChange={(e) => setDigit(i, e.target.value)}
            onKeyDown={(e) => onKey(i, e)}
            disabled={verifying}
            aria-label={`Digit ${i + 1} of 6`}
            className="h-14 w-12 rounded-xl border border-border bg-bg-elevated text-center text-2xl font-semibold tracking-widest text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
          />
        ))}
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger text-center"
        >
          {error}
        </div>
      )}
      <div className="flex flex-col gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={resend}
          disabled={resendCooldown > 0 || pending}
          className="w-full"
        >
          {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
        </Button>
        <button
          type="button"
          onClick={() => router.push('/sign-in')}
          className="text-xs text-fg-muted hover:text-fg transition"
        >
          Use a different email
        </button>
      </div>
    </div>
  );
}