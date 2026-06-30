import Link from 'next/link';
import { Music, Sparkles, ShieldCheck, Wallet, Zap, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function LandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Aurora background */}
      <div className="pointer-events-none absolute inset-0 aurora" />
      <div className="pointer-events-none absolute inset-0 [background:radial-gradient(60%_50%_at_50%_0%,transparent_0%,hsl(0_0%_4%)_70%)]" />

      <header className="relative z-10 flex items-center justify-between px-6 md:px-10 py-6">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-fg font-bold">P</div>
          <span className="text-lg font-semibold tracking-tight">Pazzera</span>
        </div>
        <Link href="/sign-in">
          <Button variant="secondary">Sign in</Button>
        </Link>
      </header>

      <section className="relative z-10 mx-auto max-w-4xl px-6 py-20 md:py-32 text-center">
        <Badge variant="accent" className="mx-auto mb-6">
          <Sparkles className="h-3 w-3" /> Now in beta
        </Badge>
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight">
          <span className="text-gradient-brand">Pay per listen.</span>
          <br />
          <span className="text-gradient-brand">Own your sound.</span>
        </h1>
        <p className="mt-6 mx-auto max-w-xl text-lg text-fg-muted">
          Pazzera is a decentralized music streaming platform. No subscriptions. No gatekeepers.
          Every stream sends a nano payment in USDC directly to the artist on Arc.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link href="/sign-in">
            <Button size="lg">
              Start listening <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
          <Link href="#how">
            <Button size="lg" variant="secondary">How it works</Button>
          </Link>
        </div>
      </section>

      <section id="how" className="relative z-10 mx-auto max-w-5xl px-6 pb-32 grid grid-cols-1 md:grid-cols-3 gap-4">
        <FeatureCard
          icon={<Zap className="h-5 w-5 text-accent" />}
          title="Nano payments"
          body="Each song has a price. When you finish past 25% of the track, a 0.001–0.005 USDC payment fires automatically."
        />
        <FeatureCard
          icon={<Wallet className="h-5 w-5 text-accent" />}
          title="Your keys, your funds"
          body="Wallets are user-controlled (Circle UCW). Pazzera never holds your money."
        />
        <FeatureCard
          icon={<ShieldCheck className="h-5 w-5 text-accent" />}
          title="Direct artist payouts"
          body="Every stream triggers a smart-contract split. The artist gets 70%, featured 20%, producer 10% — instantly."
        />
      </section>
    </main>
  );
}

function FeatureCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-border glass p-6">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-bg-elevated mb-3">{icon}</div>
      <div className="text-lg font-semibold">{title}</div>
      <p className="text-sm text-fg-muted mt-1 leading-relaxed">{body}</p>
    </div>
  );
}