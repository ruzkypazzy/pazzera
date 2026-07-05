'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { Headphones, Music, Sparkles, ArrowRight } from 'lucide-react';
import { PazzeraLogo } from '@/components/logo';

export default function SignUpChooserPage() {
  return (
    <Suspense fallback={null}>
      <SignUpChooser />
    </Suspense>
  );
}

function SignUpChooser() {
  const router = useRouter();
  const params = useSearchParams();
  // Capture any existing `?next=` so we can preserve it through the auth flow
  const next = params.get('next') || '/home';
  // Preselect from query string
  const initialIntent = params.get('intent');
  const [choice, setChoice] = useState<'listener' | 'artist' | null>(
    initialIntent === 'artist' ? 'artist' : null,
  );

  function pick(role: 'listener' | 'artist') {
    setChoice(role);
    // Persist intent in sessionStorage so the sign-in form can pick it up
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('pazzera:signin:role', role);
    }
    setTimeout(() => {
      router.push(`/sign-in?next=${encodeURIComponent(next)}`);
    }, 200);
  }

  return (
    <main className="min-h-screen px-6 py-12" style={{ background: '#0A0A0A' }}>
      <div className="mx-auto max-w-2xl">
        <div className="mb-10 flex flex-col items-center text-center">
          <Link href="/" className="mb-6 inline-block">
            <PazzeraLogo size={64} />
          </Link>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#00D4AA]/30 bg-[#00D4AA]/10 px-3 py-1">
            <Sparkles className="h-3 w-3 text-[#00D4AA]" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#00D4AA]">
              One more step
            </span>
          </div>
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-white md:text-4xl">
            How will you use Pazzera?
          </h1>
          <p className="mt-2 max-w-md text-sm text-[#B3B3B3] md:text-base">
            Choose how you want to start. You can change this later from settings.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <ChoiceCard
            icon={<Headphones className="h-6 w-6" />}
            title="I'm a listener"
            body="Discover music, build your library, and pay artists directly in USDC per stream."
            accent="#00D4AA"
            active={choice === 'listener'}
            onClick={() => pick('listener')}
          />
          <ChoiceCard
            icon={<Music className="h-6 w-6" />}
            title="I'm an artist"
            body="Upload tracks, set your price, and earn USDC every time someone listens past 25%."
            accent="#7B5EFF"
            active={choice === 'artist'}
            onClick={() => pick('artist')}
          />
        </div>

        <div className="mt-8 text-center text-xs text-[#B3B3B3]">
          Already have an account?{' '}
          <Link href={`/sign-in?next=${encodeURIComponent(next)}`} className="text-[#00D4AA] hover:underline">
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}

function ChoiceCard({
  icon,
  title,
  body,
  accent,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  accent: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      disabled={active}
      className="card relative flex flex-col items-start gap-3 p-6 text-left transition disabled:opacity-50"
      style={{
        borderColor: active ? accent : '#282828',
        boxShadow: active ? `0 0 0 1px ${accent}, 0 8px 24px ${accent}30` : undefined,
      }}
    >
      <div
        className="grid h-12 w-12 place-items-center rounded-xl"
        style={{ background: `${accent}18`, color: accent }}
      >
        {icon}
      </div>
      <div>
        <div className="text-lg font-bold text-white">{title}</div>
        <p className="mt-1 text-sm text-[#B3B3B3]">{body}</p>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider" style={{ color: accent }}>
        {active ? 'Loading…' : 'Continue'} <ArrowRight className="h-3.5 w-3.5" />
      </div>
    </motion.button>
  );
}