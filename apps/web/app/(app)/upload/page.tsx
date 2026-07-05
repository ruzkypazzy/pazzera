'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/shell/AppShell';
import { PazzeraLogo } from '@/components/logo';
import { AgentChat } from '@/components/agent/AgentChat';

export default function UploadPage() {
  const [myUsername, setMyUsername] = useState('');

  // Keep the header subtitle accurate (display name) when we have it.
  useEffect(() => {
    fetch('/api/profile')
      .then((r) => r.json())
      .then((d) => {
        if (d?.username) setMyUsername(d.username);
      })
      .catch(() => undefined);
  }, []);

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-4 pb-32">
        <header>
          <div className="flex items-center gap-3">
            <PazzeraLogo size={36} />
            <h1 className="text-2xl font-extrabold tracking-tight text-white md:text-3xl">
              PAZZERA BOT
            </h1>
            <span className="rounded-full border border-[#00D4AA]/40 bg-[#00D4AA]/15 px-2 py-0.5 text-[10px] uppercase tracking-widest text-[#00D4AA]">
              v1
            </span>
          </div>
          <p className="mt-1 text-sm text-[#B3B3B3]">
            Drop your song, drop the cover, chat with the agent. It'll suggest
            a title, mood tags, description, a fair per-stream rate (0.001–0.005 USDC),
            and handle the royalty splits — then publish straight to the curator.
          </p>
          {myUsername && (
            <p className="mt-1 text-[10px] uppercase tracking-widest text-[#6A6A6A]">
              Signed in as <span className="text-white">@{myUsername}</span> ·{' '}
              <Link href="/upload" className="text-[#00D4AA] hover:underline">
                Need the manual form? It&apos;s on the artist dashboard.
              </Link>
            </p>
          )}
        </header>

        {/* Page is now just the chat. The manual form lives on the
            artist dashboard so users don't see two forms competing. */}
        <AgentChat />
      </div>
    </AppShell>
  );
}
