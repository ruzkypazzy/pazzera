'use client';

import { ChevronRight, Sparkles } from 'lucide-react';
import { ReactNode } from 'react';

type Props = {
  title: string;
  subtitle?: string;
  agent?: 'curator' | 'discovery' | 'fan' | null;
  showAllHref?: string;
  children: ReactNode;
};

export function SectionRow({ title, subtitle, agent = null, showAllHref, children }: Props) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-extrabold tracking-tight text-white">{title}</h2>
            {agent && (
              <span className="badge-agent">
                <Sparkles className="h-2.5 w-2.5" />
                {agent === 'curator' ? 'Curator Agent' : agent === 'discovery' ? 'Discovery Agent' : 'Fan Agent'}
              </span>
            )}
          </div>
          {subtitle && <p className="mt-1 text-sm text-[#B3B3B3]">{subtitle}</p>}
        </div>
        {showAllHref && (
          <a
            href={showAllHref}
            className="hidden items-center gap-1 text-xs font-bold uppercase tracking-wider text-[#B3B3B3] transition hover:text-white md:flex"
          >
            Show all <ChevronRight className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
      <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-2 no-scrollbar md:grid md:grid-cols-2 md:gap-4 md:overflow-visible md:px-0 lg:grid-cols-3 xl:grid-cols-6">
        {children}
      </div>
    </section>
  );
}