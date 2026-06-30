'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Clock, AlertCircle, Loader2, Zap, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/cn';

interface TimelineEvent {
  ts: number;
  kind: 'payment_due' | 'payment_authorized' | 'payment_submitted' | 'payment_confirmed' | 'failed';
  meta?: Record<string, unknown>;
}

interface PaymentTimeline {
  paymentId: string;
  events: TimelineEvent[];
  amountUsdc?: string;
  txHash?: string;
  network?: string;
}

/**
 * Settlement Timeline — payment_due → authorized → submitted → confirmed.
 * Animates each step as it transitions; latency bars show the time elapsed
 * between transitions.
 */
export function SettlementTimeline({ paymentId, live = false }: { paymentId: string; live?: boolean }) {
  const [timeline, setTimeline] = useState<PaymentTimeline | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const fetchTimeline = async () => {
      try {
        const r = await fetch(`/api/admin/payment/${paymentId}/timeline`);
        if (!r.ok) {
          setErr(r.status === 404 ? 'Payment not found' : `fetch_failed_${r.status}`);
          return;
        }
        setTimeline((await r.json()) as PaymentTimeline);
      } catch (e) {
        setErr((e as Error).message);
      }
    };
    void fetchTimeline();
    if (!live) return;
    const t = setInterval(fetchTimeline, 2_000);
    return () => clearInterval(t);
  }, [paymentId, live]);

  if (err) {
    return (
      <div className="rounded-xl border border-border bg-bg-elevated/60 p-4 text-sm text-fg-muted">
        {err}
      </div>
    );
  }
  if (!timeline) {
    return (
      <div className="grid gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 rounded-xl bg-bg-muted/60 animate-pulse" />
        ))}
      </div>
    );
  }

  const steps: Array<{ key: TimelineEvent['kind']; label: string; icon: typeof Zap }> = [
    { key: 'payment_due', label: 'Due', icon: Zap },
    { key: 'payment_authorized', label: 'Authorized', icon: Check },
    { key: 'payment_submitted', label: 'Submitted', icon: Loader2 },
    { key: 'payment_confirmed', label: 'Confirmed', icon: Check },
  ];
  const failed = timeline.events.some((e) => e.kind === 'failed');

  const eventsByStep: Record<string, TimelineEvent | undefined> = {};
  for (const e of timeline.events) eventsByStep[e.kind] = e;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold">Settlement Timeline</div>
        {timeline.txHash && (
          <a
            className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
            href={`https://testnet.arcscan.app/tx/${timeline.txHash}`}
            target="_blank"
            rel="noreferrer"
          >
            View on explorer <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      <div className="relative flex items-stretch gap-2">
        {steps.map((step, i) => {
          const event = eventsByStep[step.key];
          const Icon = step.icon;
          const isDone = !!event && !failed;
          const isFailed = failed && step.key === 'payment_due' ? false : false;
          const nextEvent = i === 0 ? null : eventsByStep[steps[i - 1]!.key];
          const latencyMs = nextEvent && event ? event.ts - nextEvent.ts : 0;
          return (
            <div key={step.key} className="flex-1">
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className={cn(
                  'rounded-xl border p-2.5 text-xs flex items-start gap-2',
                  isDone
                    ? 'border-accent/30 bg-accent/10'
                    : failed
                      ? 'border-danger/30 bg-danger/10'
                      : 'border-border bg-bg-elevated/60 text-fg-muted',
                )}
              >
                <div
                  className={cn(
                    'grid h-6 w-6 place-items-center rounded-full flex-shrink-0',
                    isDone ? 'bg-accent text-bg' : 'bg-bg-muted text-fg-muted',
                  )}
                >
                  {isDone ? (
                    <Icon className="h-3 w-3" />
                  ) : failed ? (
                    <AlertCircle className="h-3 w-3 text-danger" />
                  ) : (
                    <Clock className="h-3 w-3" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-fg truncate">{step.label}</div>
                  <div className="text-[10px] text-fg-muted">
                    {event ? new Date(event.ts).toLocaleTimeString() : 'pending'}
                  </div>
                  {i > 0 && latencyMs > 0 && (
                    <div className="mt-1 h-1 w-full rounded-full bg-bg-muted overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(100, (latencyMs / 5_000) * 100)}%` }}
                        transition={{ duration: 0.6 }}
                        className="h-full bg-accent"
                      />
                    </div>
                  )}
                  {i > 0 && latencyMs > 0 && (
                    <div className="text-[10px] text-fg-muted mt-0.5">+{latencyMs}ms</div>
                  )}
                </div>
              </motion.div>
            </div>
          );
        })}
      </div>

      {failed && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 p-2 text-xs text-danger">
          A failure occurred in this settlement. Check PaymentEvent rows for details.
        </div>
      )}

      {timeline.amountUsdc && (
        <div className="text-xs text-fg-muted text-right">
          Amount: <span className="text-accent tabular-nums">{timeline.amountUsdc} USDC</span>
          {timeline.network && <> · Network: <span className="font-mono">{timeline.network}</span></>}
        </div>
      )}
    </div>
  );
}
