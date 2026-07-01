import Link from 'next/link';
import { AppShell } from '@/components/shell/AppShell';
import { SignOutButton } from '@/components/auth/SignOutButton';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Settings — Pazzera',
};

export default function SettingsPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-8 md:px-8">
        <header>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#00D4AA]">Account</div>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight">Settings</h1>
          <p className="mt-2 text-sm text-[#B3B3B3]">Manage your account, wallet, and security.</p>
        </header>

        <div className="overflow-hidden rounded-2xl border border-[#282828] bg-[#0F0F18]">
          <Link
            href="/profile"
            className="flex items-center gap-4 px-5 py-4 transition hover:bg-white/[0.04]"
          >
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#00D4AA]/10 text-2xl">
              👤
            </div>
            <div className="flex-1">
              <div className="font-semibold text-white">Profile</div>
              <div className="text-sm text-[#B3B3B3]">Display name, avatar, bio</div>
            </div>
            <svg className="h-4 w-4 text-[#B3B3B3]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>
          </Link>
          <div className="h-px bg-[#282828]" />
          <Link
            href="/wallet"
            className="flex items-center gap-4 px-5 py-4 transition hover:bg-white/[0.04]"
          >
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#00D4AA]/10 text-2xl">
              💳
            </div>
            <div className="flex-1">
              <div className="font-semibold text-white">Wallet</div>
              <div className="text-sm text-[#B3B3B3]">Balance, addresses, transactions</div>
            </div>
            <svg className="h-4 w-4 text-[#B3B3B3]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>
          </Link>
          <div className="h-px bg-[#282828]" />
          <SettingsRow
            title="Notifications"
            desc="Email + push preferences"
            icon="🔔"
            badge="Soon"
          />
          <div className="h-px bg-[#282828]" />
          <SettingsRow
            title="Privacy"
            desc="Listening history, public profile"
            icon="🔒"
            badge="Soon"
          />
          <div className="h-px bg-[#282828]" />
          <SettingsRow
            title="Help & feedback"
            desc="Send us a note or report an issue"
            icon="💬"
            href="mailto:hello@pazzera.com"
          />
        </div>

        <SignOutButton />
      </div>
    </AppShell>
  );
}

function SettingsRow({
  title,
  desc,
  icon,
  badge,
  href,
}: {
  title: string;
  desc: string;
  icon: string;
  badge?: string;
  href?: string;
}) {
  const inner = (
    <>
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-2xl">
        {icon}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2 font-semibold text-white">
          {title}
          {badge && (
            <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#B3B3B3]">
              {badge}
            </span>
          )}
        </div>
        <div className="text-sm text-[#B3B3B3]">{desc}</div>
      </div>
      <svg className="h-4 w-4 text-[#B3B3B3]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>
    </>
  );
  if (href) {
    return (
      <a
        href={href}
        className="flex items-center gap-4 px-5 py-4 transition hover:bg-white/[0.04]"
      >
        {inner}
      </a>
    );
  }
  // No href: render as a disabled-looking row (still clickable for the
  // Soon badge, but visually distinct so users know it's not implemented
  // yet). Tapping still works — it just opens a mailto for feedback.
  return (
    <div className="flex cursor-pointer items-center gap-4 px-5 py-4 opacity-60 transition hover:bg-white/[0.04] hover:opacity-100">
      {inner}
    </div>
  );
}