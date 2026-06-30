'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Search, Library, Wallet, Music4, ShieldCheck, User2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';

interface SidebarProps {
  isArtist: boolean;
  isAdmin: boolean;
}

const ITEMS = [
  { href: '/dashboard', label: 'Home', icon: Home },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/library', label: 'Library', icon: Library },
  { href: '/wallet', label: 'Wallet', icon: Wallet },
] as const;

const ARTIST_ITEMS = [{ href: '/artist', label: 'Artist', icon: Music4 }] as const;

const ADMIN_ITEMS = [{ href: '/admin', label: 'Admin', icon: ShieldCheck }] as const;

export function Sidebar({ isArtist, isAdmin }: SidebarProps) {
  const path = usePathname();

  function isActive(href: string) {
    if (href === '/dashboard') return path === href;
    return path?.startsWith(href);
  }

  function renderItem(href: string, label: string, Icon: typeof Home) {
    const active = isActive(href);
    return (
      <Link
        key={href}
        href={href}
        className={cn(
          'group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition',
          active
            ? 'bg-accent/10 text-accent'
            : 'text-fg-muted hover:text-fg hover:bg-bg-elevated',
        )}
      >
        <Icon
          className={cn(
            'h-4 w-4 transition',
            active ? 'text-accent' : 'text-fg-muted group-hover:text-fg',
          )}
        />
        <span className="font-medium">{label}</span>
        {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" />}
      </Link>
    );
  }

  return (
    <aside className="hidden md:flex h-full w-60 flex-col border-r border-border bg-bg/60 backdrop-blur-xl">
      <div className="px-5 py-6">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-fg font-bold">
            P
          </div>
          <div className="flex flex-col">
            <span className="text-base font-semibold tracking-tight">Pazzera</span>
            <span className="text-[10px] text-fg-muted -mt-0.5">pay per listen</span>
          </div>
        </Link>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {ITEMS.map((i) => renderItem(i.href, i.label, i.icon))}
        {isArtist && ARTIST_ITEMS.map((i) => renderItem(i.href, i.label, i.icon))}
        {isAdmin && ADMIN_ITEMS.map((i) => renderItem(i.href, i.label, i.icon))}
      </nav>

      <div className="m-3 rounded-2xl glass p-4 text-xs space-y-2">
        <div className="flex items-center gap-2 text-fg-muted">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          <span>Demo mode active</span>
        </div>
        <p className="text-fg-muted leading-relaxed">
          Live payments fire every 12s. No real funds move — this is a simulated run for the hackathon demo.
        </p>
      </div>

      <div className="px-3 pb-4">
        <Link
          href="/profile"
          className={cn(
            'flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition',
            isActive('/profile')
              ? 'bg-accent/10 text-accent'
              : 'text-fg-muted hover:text-fg hover:bg-bg-elevated',
          )}
        >
          <User2 className="h-4 w-4" />
          <span>Profile</span>
        </Link>
      </div>
    </aside>
  );
}