export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-24">
      <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-center bg-gradient-to-br from-fg to-fg/60 bg-clip-text text-transparent">
        Pazzera
      </h1>
      <p className="mt-6 text-lg text-fg-muted text-center max-w-xl">
        Pay per listen. Direct artist payouts. No gatekeepers, no monthly fees.
        Music settles in USDC on Arc.
      </p>
      <div className="mt-10 flex gap-4">
        <a
          href="/sign-in"
          className="rounded-full bg-accent text-accent-fg px-6 py-3 font-medium hover:bg-accent/90 transition"
        >
          Start listening
        </a>
        <a
          href="#how"
          className="rounded-full border border-border px-6 py-3 hover:bg-bg-elevated transition"
        >
          How it works
        </a>
      </div>
    </main>
  );
}