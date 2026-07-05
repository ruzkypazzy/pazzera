import React from 'react';
import Link from 'next/link';
import { PazzeraLogo } from '@/components/logo';

/**
 * Guest shell — used for the landing page (no auth required).
 * - Top-right corner: small "Sign in" / "Create account" buttons
 * - Centered content
 * - No avatar, no player bar, no bottom nav
 */
export function GuestShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: '#0A0A0A' }}>
      <header className="fixed inset-x-0 top-0 z-40 h-[88px] border-b border-[#282828]"
        style={{
          background: 'rgba(10,10,10,0.78)',
          backdropFilter: 'blur(24px) saturate(180%)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        }}
      >
        <div className="mx-auto flex h-full max-w-screen-2xl items-center justify-between gap-4 px-4 md:px-8">
          <Link href="/" className="shrink-0">
            <PazzeraLogo size={56} />
          </Link>
          <div className="flex items-center gap-2 md:gap-3">
            <Link href="/sign-in"><button className="btn-secondary !py-1.5 !px-3 text-xs md:!py-2 md:!px-4 md:text-sm">Sign in</button></Link>
            <Link href="/sign-up"><button className="btn-primary !py-1.5 !px-3 text-xs md:!py-2 md:!px-4 md:text-sm">Create account</button></Link>
          </div>
        </div>
      </header>
      <main className="pt-[72px]">
        {children}
      </main>
    </div>
  );
}