'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, Bell, LogOut, Wallet as WalletIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';

interface TopBarProps {
  user: { username: string; displayName: string | null; avatarUrl: string | null };
  wallet: { address: string; balanceUsdc: string } | null;
}

export function TopBar({ user, wallet }: TopBarProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/sign-in');
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/70 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 px-4 md:px-6">
        {/* Search */}
        <Link
          href="/search"
          className="flex flex-1 items-center gap-2 rounded-full border border-border bg-bg-elevated/70 px-4 py-2 text-sm text-fg-muted hover:border-fg-subtle transition max-w-md"
        >
          <Search className="h-4 w-4" />
          <span>Search songs, artists, users…</span>
          <span className="ml-auto hidden md:inline rounded bg-bg-muted px-1.5 py-0.5 text-[10px]">⌘K</span>
        </Link>

        <div className="flex-1" />

        {/* Wallet balance pill */}
        {wallet && (
          <Link
            href="/wallet"
            className="hidden md:flex items-center gap-2 rounded-full border border-border bg-bg-elevated px-3 py-1.5 text-sm hover:border-accent/40 transition"
          >
            <WalletIcon className="h-3.5 w-3.5 text-accent" />
            <span className="tabular-nums font-medium">
              {Number(wallet.balanceUsdc).toFixed(4)}
            </span>
            <span className="text-fg-muted text-xs">USDC</span>
          </Link>
        )}

        {/* Notifications */}
        <button
          className="rounded-full p-2 text-fg-muted hover:text-fg hover:bg-bg-elevated transition"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
        </button>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-full p-0.5 hover:ring-2 hover:ring-ring transition"
            aria-label="User menu"
          >
            <Avatar className="h-8 w-8">
              {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={user.username} /> : null}
              <AvatarFallback>{(user.displayName ?? user.username).slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-12 z-50 w-56 rounded-2xl glass-strong p-2 text-sm">
                <div className="px-3 py-2 border-b border-border mb-1">
                  <div className="font-medium">{user.displayName ?? user.username}</div>
                  <div className="text-xs text-fg-muted">@{user.username}</div>
                </div>
                <Link
                  href="/profile"
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-lg px-3 py-2 hover:bg-bg-elevated transition"
                >
                  Profile
                </Link>
                <Link
                  href="/wallet"
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-lg px-3 py-2 hover:bg-bg-elevated transition"
                >
                  Wallet
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={logout}
                  className="w-full justify-start mt-1"
                >
                  <LogOut className="h-3.5 w-3.5 mr-2" />
                  Sign out
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}