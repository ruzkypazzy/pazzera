'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Search, Library, Wallet, Settings, Upload } from 'lucide-react';

type Props = {
  isArtist?: boolean;
};

export function BottomNav({ isArtist = false }: Props) {
  const pathname = usePathname();

  const base = [
    { href: '/home', label: 'Home', icon: Home },
    { href: '/search', label: 'Search', icon: Search },
    { href: '/library', label: 'Library', icon: Library },
    { href: '/wallet', label: 'Wallet', icon: Wallet },
    { href: '/settings', label: 'Settings', icon: Settings },
  ];
  const items = isArtist
    ? [...base.slice(0, 4), { href: '/upload', label: 'Upload', icon: Upload }, base[4]]
    : base;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 h-[68px] border-t border-[#282828]"
      style={{
        background: 'rgba(10,10,10,0.85)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
      }}
    >
      <div className="mx-auto flex h-full max-w-screen-md items-center justify-around px-1">
        {items.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 transition"
              aria-label={item.label}
            >
              <div
                className={`flex h-9 items-center gap-1.5 rounded-full px-3 transition ${
                  isActive
                    ? 'bg-[#00D4AA]/15 text-[#00D4AA]'
                    : 'text-[#B3B3B3] hover:text-white'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className={`text-[10px] font-bold uppercase tracking-wider ${isActive ? '' : 'hidden md:inline'}`}>
                  {item.label}
                </span>
              </div>
              {isActive && (
                <span className="absolute -top-px left-1/2 h-[3px] w-8 -translate-x-1/2 rounded-full bg-[#00D4AA]" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}