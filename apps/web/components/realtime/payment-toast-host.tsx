'use client';
import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Music, Sparkles, X } from 'lucide-react';
import { useRealtimePayments, useDemoPaymentSimulation, type PaymentToastEvent } from '@/lib/realtime';
import { useDemoMode } from '@/lib/demo-mode';

interface ToastItem {
  id: string;
  title: string;
  body: string;
  variant: 'payment' | 'split';
  amount?: string;
  details?: string;
  createdAt: number;
}

const TOAST_TTL_MS = 6500;

export function PaymentToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const demo = useDemoMode();

  const onEvent = useCallback((evt: PaymentToastEvent) => {
    setToasts((prev) => {
      const id = `${evt.type}-${evt.streamId}-${Date.now()}`;
      let item: ToastItem;
      if (evt.type === 'stream:payment_settled') {
        item = {
          id,
          variant: 'payment',
          title: `🎵 Stream qualified — ${evt.amountUsdc} USDC sent`,
          body: `${evt.songTitle ?? 'Song'} • @${evt.artistUsername ?? 'artist'}`,
          amount: evt.amountUsdc,
          createdAt: Date.now(),
        };
      } else {
        const parts = evt.recipients
          .slice(0, 3)
          .map((r) => `${(Number(r.amount) * 100).toFixed(0)}% ${r.username}`)
          .join(' • ');
        const more = evt.recipients.length > 3 ? ` +${evt.recipients.length - 3}` : '';
        item = {
          id,
          variant: 'split',
          title: `Split Agent distributed ${evt.totalDistributed} USDC`,
          body: parts + more,
          amount: evt.totalDistributed,
          createdAt: Date.now(),
        };
      }
      return [...prev.slice(-3), item];
    });
  }, []);

  useRealtimePayments(onEvent);
  useDemoPaymentSimulation(demo.enabled, onEvent);

  // Auto-dismiss
  useEffect(() => {
    if (toasts.length === 0) return;
    const t = setInterval(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => now - t.createdAt < TOAST_TTL_MS));
    }, 500);
    return () => clearInterval(t);
  }, [toasts.length]);

  function dismiss(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div className="fixed bottom-28 right-6 z-50 flex w-[360px] max-w-[calc(100vw-3rem)] flex-col gap-3 pointer-events-none">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, x: 80, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 80, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 280, damping: 26 }}
            className="pointer-events-auto"
          >
            <div
              className={`relative overflow-hidden rounded-2xl glass-strong p-4 pr-10 ${
                t.variant === 'payment' ? 'neon-ring' : ''
              }`}
            >
              {/* Decorative scan line */}
              <div
                aria-hidden
                className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent to-transparent opacity-70"
              />
              <div className="flex items-start gap-3">
                <div
                  className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                    t.variant === 'payment'
                      ? 'bg-accent/20 text-accent'
                      : 'bg-fg/10 text-fg-muted'
                  }`}
                >
                  {t.variant === 'payment' ? (
                    <Music className="h-4 w-4" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium leading-tight">{t.title}</div>
                  <div className="mt-0.5 text-xs text-fg-muted truncate">{t.body}</div>
                </div>
              </div>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="absolute right-2 top-2 rounded-full p-1 text-fg-muted hover:text-fg hover:bg-bg-elevated"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}