'use client';

import Link from 'next/link';
import { PazzeraLogo } from '@/components/logo';

export function LandingHero() {
  return (
    <div className="mx-auto max-w-screen-xl px-4 py-10 md:px-8 md:py-16">
      {/* HERO */}
      <section className="relative overflow-hidden rounded-3xl border border-white/[0.06] p-6 md:p-12">
        <div
          className="absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(700px 360px at 90% 0%, rgba(123,94,255,0.45), transparent 60%),' +
              'radial-gradient(500px 280px at 0% 100%, rgba(0,245,225,0.30), transparent 55%),' +
              'linear-gradient(135deg,#14141F 0%,#0a0a12 100%)',
          }}
        />
        <div className="flex flex-col items-start gap-8 md:flex-row md:items-center md:justify-between">
          <div className="flex-1">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-[#00F5E1] shadow-[0_0_8px_#00F5E1]" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">Live on Arc Testnet</span>
            </div>
            <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight md:text-6xl">
              <span className="text-gradient-brand">Pay once.</span>
              <br />
              <span className="text-white">Every time.</span>
            </h1>
            <p className="mt-4 max-w-md text-base text-white/65 md:text-lg">
              Pazzera is the music platform where every stream pays artists directly in USDC on Arc.
              No subscription, no ads, no middlemen — just music that earns.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/sign-in"><button className="btn-primary">Start listening →</button></Link>
              <Link href="/sign-up?intent=artist"><button className="btn-secondary">Become an artist</button></Link>
            </div>
            <div className="mt-5 text-[11px] text-white/45">
              Real artists · Real streams · Real USDC
            </div>
          </div>
          <div className="hidden md:block">
            <div className="relative h-72 w-72">
              <div
                className="absolute inset-0 grid place-items-center rounded-3xl"
                style={{
                  background: 'linear-gradient(135deg, rgba(123,94,255,0.35) 0%, rgba(0,245,225,0.25) 100%)',
                  boxShadow: '0 30px 80px rgba(123,94,255,0.25)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <PazzeraLogo size={200} showWord={false} size_t="lg" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* VALUE PROPS */}
      <section className="mt-10 grid gap-4 md:grid-cols-3">
        <ValueProp
          title="Pay per stream"
          body="Set your own per-stream price. Listeners pay once at 25% of the song, then stream free until the track ends. Re-listening is a new stream."
          gradient="linear-gradient(135deg,#7B5EFF,#5B3FD8)"
        />
        <ValueProp
          title="Settled on Arc"
          body="USDC settles through Circle's x402 + Gateway. Every cent accounted for on-chain."
          gradient="linear-gradient(135deg,#00F5E1,#3CD8C7)"
        />
        <ValueProp
          title="Pazzera has custody"
          body="Every wallet is a Circle Developer-Controlled Wallet. Address + key come from Circle, every signature is server-side, no key extraction needed."
          gradient="linear-gradient(135deg,#FF6BA9,#FF3D8A)"
        />
      </section>

      {/* HOW IT WORKS */}
      <section className="mt-10 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 md:p-8">
        <h2 className="text-2xl font-bold tracking-tight">How it works</h2>
        <p className="mt-1 text-sm text-white/55">Three steps from zero to earning.</p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <Step n={1} title="Sign in">
            Email → wallet → listen. No password, no friction.
          </Step>
          <Step n={2} title="Press play">
            Audio streams over HTTP with a payment stream that ticks every second.
          </Step>
          <Step n={3} title="Get paid">
            USDC auto-settles through Circle Gateway to the artist's wallet.
          </Step>
        </div>
      </section>
    </div>
  );
}

function ValueProp({ title, body, gradient }: { title: string; body: string; gradient: string }) {
  return (
    <div className="card">
      <div className="mb-4 inline-block h-10 w-10 rounded-xl" style={{ background: gradient }} />
      <div className="text-base font-bold">{title}</div>
      <p className="mt-1 text-sm text-white/60">{body}</p>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#7B5EFF] to-[#00F5E1] text-sm font-bold text-white">
        {n}
      </div>
      <div>
        <div className="font-bold">{title}</div>
        <p className="mt-1 text-sm text-white/55">{children}</p>
      </div>
    </div>
  );
}