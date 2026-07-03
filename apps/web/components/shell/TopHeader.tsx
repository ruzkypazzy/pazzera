'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Search, Bell, ChevronDown, User, Settings, LogOut, LayoutDashboard, Upload, Wallet as WalletIcon, Music } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { PazzeraLogo } from '@/components/logo';

type Props = {
  isArtist?: boolean;
  isAdmin?: boolean;
  walletBalance?: string; // pre-formatted USDC, e.g. "12.45"
  displayName?: string;
  username?: string;
};

export function TopHeader({
  isArtist = false,
  isAdmin = false,
  walletBalance = '0.00',
  displayName,
  username,
}: Props) {
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const roleLabel = isAdmin ? 'Admin' : isArtist ? 'Artist' : 'Listener';
  const accountLabel = displayName || username
    ? `${displayName || username} · ${roleLabel}`
    : `Pazzera ${roleLabel}`;

  // Close avatar menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const title =
    pathname === '/home' ? 'Home' :
    pathname.startsWith('/library') ? 'Your Library' :
    pathname.startsWith('/search') ? 'Search' :
    pathname.startsWith('/wallet') ? 'Wallet' :
    pathname.startsWith('/upload') ? 'Upload' :
    pathname.startsWith('/artist') ? 'Artist Studio' :
    pathname.startsWith('/curator') ? 'AI Curator' :
    pathname.startsWith('/profile') ? 'Profile' :
    pathname.startsWith('/settings') ? 'Settings' :
    pathname.startsWith('/dashboard') ? 'Dashboard' :
    pathname.startsWith('/song') ? 'Now playing' :
    'Pazzera';

  return (
    <header
      className="fixed inset-x-0 top-0 z-40 h-[72px] border-b border-[#282828]"
      style={{
        background: 'rgba(10,10,10,0.78)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
      }}
    >
      <div className="mx-auto flex h-full max-w-screen-2xl items-center gap-3 px-4 md:gap-5 md:px-6 py-2">
        {/* LEFT: Logo */}
        <Link href="/home" className="shrink-0">
          <PazzeraLogo size={48} />
        </Link>

        {/* CENTER: Persistent search */}
        <div className="flex flex-1 items-center gap-2 md:gap-4">
          <Link
            href="/home"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#1F1F1F] text-white/85 transition hover:bg-[#282828]"
            aria-label="Home"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3 2.5 12h2v8h5v-5h5v5h5v-8h2z"/></svg>
          </Link>
          <motion.div
            layout
            animate={{ maxWidth: searchOpen ? 720 : 480 }}
            className="relative w-full"
          >
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/55">
              <Search className="h-4 w-4" />
            </span>
            <input
              type="text"
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setSearchOpen(false)}
              placeholder="Search tracks, artists, playlists"
              className="input !py-2.5 !pl-11 !pr-4 text-sm placeholder:text-white/40"
              aria-label="Search"
            />
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-mono text-white/45 md:inline">
              ⌘ K
            </kbd>
          </motion.div>
        </div>

        {/* RIGHT: Live USDC + bell + avatar */}
        <div className="flex shrink-0 items-center gap-2 md:gap-3">
          <Link
            href="/wallet"
            className="hidden items-center gap-2 rounded-full border border-[#00D4AA]/35 bg-[#00D4AA]/10 px-3.5 py-1.5 transition hover:bg-[#00D4AA]/15 md:flex"
            title="Wallet balance — live"
          >
            <span
              className="h-2 w-2 animate-pulse rounded-full"
              style={{ background: '#00D4AA', boxShadow: '0 0 10px #00D4AA' }}
            />
            <span className="text-xs font-bold tabular-nums text-white">{walletBalance}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#00D4AA]">USDC</span>
          </Link>

          <button
            onClick={() => {
              // TODO: wire to /api/notifications when endpoint exists.
              // For now, show a friendly toast via window alert (cheap & works).
              if (typeof window !== 'undefined') {
                window.alert('No new notifications.');
              }
            }}
            className="relative grid h-9 w-9 place-items-center rounded-full bg-[#1F1F1F] text-white/70 transition hover:bg-[#282828] hover:text-white"
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#00D4AA]" />
          </button>

          <div ref={menuRef} className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-full bg-[#1F1F1F] py-1 pl-1 pr-2 transition hover:bg-[#282828]"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <div
                className="grid h-7 w-7 place-items-center rounded-full text-xs font-bold text-white ring-1 ring-white/15"
                style={{ background: 'linear-gradient(135deg,#7B5EFF,#00F5E1)' }}
              >
                P
              </div>
              <ChevronDown className="h-3 w-3 text-white/55" />
            </button>
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.12 }}
                  className="absolute right-0 top-[calc(100%+8px)] w-60 overflow-hidden rounded-xl border border-[#282828] bg-[#181818] py-1 shadow-2xl"
                  role="menu"
                >
                  <div className="border-b border-[#282828] px-4 py-3">
                    <div className="text-sm font-semibold text-white">{accountLabel}</div>
                    <div className="text-xs text-[#B3B3B3]">{walletBalance} USDC</div>
                  </div>
                  <MenuLink href="/profile" icon={<User className="h-4 w-4" />}>Profile</MenuLink>
                  <MenuLink href="/dashboard" icon={<LayoutDashboard className="h-4 w-4" />}>Dashboard</MenuLink>
                  <MenuLink href="/wallet" icon={<WalletIcon className="h-4 w-4" />}>Wallet</MenuLink>
                  {isArtist && (
                    <MenuLink href="/upload" icon={<Upload className="h-4 w-4" />}>Upload</MenuLink>
                  )}
                  {isAdmin && (
                    <MenuLink href="/admin" icon={<Music className="h-4 w-4" />}>Admin</MenuLink>
                  )}
                  <div className="my-1 border-t border-[#282828]" />
                  <MenuLink href="/settings" icon={<Settings className="h-4 w-4" />}>Settings</MenuLink>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        await fetch('/api/auth/logout', { method: 'POST' });
                      } catch {
                        // ignore network errors; the cookie is what matters
                      }
                      // Hard reload to ensure all client state is reset
                      window.location.href = '/';
                    }}
                  >
                    <button
                      type="submit"
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[#B3B3B3] transition hover:bg-[#282828] hover:text-white"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign out
                    </button>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </header>
  );
}

function MenuLink({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-2.5 text-sm text-[#B3B3B3] transition hover:bg-[#282828] hover:text-white"
    >
      {icon}
      {children}
    </Link>
  );
}