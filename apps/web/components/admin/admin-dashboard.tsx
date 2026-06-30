'use client';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Music,
  DollarSign,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Cpu,
  Shield,
  Brain,
  Eye,
  Sparkles,
  Bot,
  Zap,
  X,
  ChevronRight,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { SettlementTimeline } from '@/components/admin/settlement-timeline';

interface AdminData {
  metrics: {
    totalUsers: number;
    activeListeners: number;
    artists: number;
    streamsToday: number;
    totalPayments: number;
    totalUsdcVolume: string;
    pendingReviewCount: number;
  };
  agentFeed: AgentEvent[];
  decisions: DecisionEvent[];
  fraudAlerts: FraudAlertRow[];
  reviewQueue: ReviewQueueRow[];
  riskEvents: { id: string; type: string; severity: number; meta: Record<string, unknown> | null; createdAt: string }[];
  queueStatus: { name: string; waiting: number; active: number; failed: number; delayed: number }[];
}

interface AgentEvent {
  id: string;
  agent: string;
  subjectType: string | null;
  subjectId: string | null;
  decision: string;
  reason: string | null;
  createdAt: string;
}

interface DecisionEvent {
  id: string;
  agent: string;
  subjectType: string;
  subjectId: string;
  decision: string;
  confidence: number;
  reasons: string[];
  latencyMs: number | null;
  createdAt: string;
  songId?: string | null;
  streamId?: string | null;
  paymentId?: string | null;
  userId?: string | null;
}

interface FraudAlertRow {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  entityType: string;
  entityId: string;
  score: number;
  reasons: string[];
  autoActioned: boolean;
  autoAction: string | null;
  status: string;
  createdAt: string;
}

interface ReviewQueueRow {
  id: string;
  status: string;
  fraudScore: number;
  createdAt: string;
  song: { id: string; title: string; artistName: string };
  user: { id: string; username: string };
  stream: { id: string; classification: string; fraudScore: number; songId: string };
}

const AGENT_META: Record<string, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  curator: { label: 'Curator', color: 'accent', icon: Sparkles },
  fan: { label: 'Fan Agent', color: 'info', icon: Eye },
  split: { label: 'Split', color: 'success', icon: DollarSign },
  discovery: { label: 'Discovery', color: 'warning', icon: Brain },
  fraud_sentinel: { label: 'Fraud', color: 'danger', icon: Shield },
};

const COLOR_CLASSES: Record<string, string> = {
  accent: 'bg-accent/15 text-accent border-accent/30',
  info: 'bg-info/15 text-info border-info/30',
  success: 'bg-success/15 text-success border-success/30',
  warning: 'bg-warning/15 text-warning border-warning/30',
  danger: 'bg-danger/15 text-danger border-danger/30',
};

export function AdminDashboard() {
  const [data, setData] = useState<AdminData | null>(null);
  const [selected, setSelected] = useState<DecisionDetail | null>(null);
  const [explaining, setExplaining] = useState<string | null>(null);

  useEffect(() => {
    const fetchIt = () =>
      fetch('/api/admin/overview').then((r) => r.json()).then(setData).catch(() => undefined);
    fetchIt();
    const t = setInterval(fetchIt, 10_000);
    return () => clearInterval(t);
  }, []);

  async function openExplanation(id: string) {
    setExplaining(id);
    try {
      const r = await fetch(`/api/admin/decision/${id}`);
      const d = (await r.json()) as { decision: DecisionDetail };
      setSelected(d.decision);
    } finally {
      setExplaining(null);
    }
  }

  async function decideReview(reviewId: string, action: 'approve' | 'reject' | 'refund') {
    const note = action === 'approve' ? 'admin approved' : action === 'reject' ? 'admin rejected — fraudulent' : 'admin refunded stream';
    await fetch('/api/admin/review-queue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reviewId, action, note }),
    });
    const r = await fetch('/api/admin/overview');
    setData((await r.json()) as AdminData);
  }

  if (!data) return <AdminSkeleton />;

  return (
    <div className="mx-auto max-w-7xl px-4 md:px-8 py-6 space-y-8">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">System intelligence</h1>
          <p className="text-fg-muted text-sm mt-1">Live view of every agent, queue, and risk signal on Pazzera.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => location.reload()}>
          <Activity className="h-3.5 w-3.5 mr-2" /> Refresh
        </Button>
      </header>

      {/* Platform metrics */}
      <section data-testid="overview-card" className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi label="Total users" value={String(data.metrics.totalUsers)} icon={<Users className="h-4 w-4 text-accent" />} />
        <Kpi label="Artists" value={String(data.metrics.artists)} icon={<Music className="h-4 w-4 text-accent" />} />
        <Kpi label="Streams (24h)" value={String(data.metrics.streamsToday)} icon={<Activity className="h-4 w-4 text-accent" />} />
        <Kpi label="USDC volume" value={data.metrics.totalUsdcVolume} icon={<DollarSign className="h-4 w-4 text-accent" />} />
        <Kpi label="Pending reviews" value={String(data.metrics.pendingReviewCount)} icon={<Shield className="h-4 w-4 text-danger" />} highlight={data.metrics.pendingReviewCount > 0} />
      </section>

      {/* Agent Activity */}
      <section className="grid lg:grid-cols-3 gap-4">
        <Card
          icon={<Bot className="h-4 w-4 text-accent" />}
          title="Agent decisions (explainable)"
          subtitle="Click any decision for the full transparency card"
          className="lg:col-span-2"
          data-testid="agent-health-card"
        >
          <div className="space-y-1.5 max-h-[480px] overflow-y-auto pr-2">
            {data.decisions.map((d) => {
              const meta = AGENT_META[d.agent] ?? AGENT_META.curator!;
              const Icon = meta.icon;
              return (
                <button
                  key={d.id}
                  onClick={() => openExplanation(d.id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border bg-bg-elevated/60 px-3 py-2 text-left transition hover:border-accent/40 hover:bg-bg-elevated"
                >
                  <div className={cn('rounded-lg border p-1.5', COLOR_CLASSES[meta.color])}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{meta.label}</span>
                      <span className="text-fg-muted">·</span>
                      <span className="truncate text-fg-muted">{d.subjectType}/{d.subjectId.slice(0, 8)}</span>
                    </div>
                    {d.reasons[0] && <div className="text-xs text-fg-muted truncate">{d.reasons[0]}</div>}
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <Badge variant={badgeVariantForDecision(d.decision)}>{d.decision}</Badge>
                    <span className="text-[10px] text-fg-muted">{d.confidence}% conf</span>
                  </div>
                </button>
              );
            })}
            {explaining && (
              <div className="text-xs text-fg-muted px-3 py-2">Fetching decision details…</div>
            )}
            {data.decisions.length === 0 && (
              <div className="text-sm text-fg-muted px-3 py-6 text-center">
                No AI decisions yet — stream a song or upload one to see the agents in action.
              </div>
            )}
          </div>
        </Card>

        <Card icon={<Activity className="h-4 w-4 text-accent" />} title="Live activity stream">
          <div className="space-y-1.5 max-h-[480px] overflow-y-auto pr-2">
            {data.agentFeed.length === 0 && (
              <div className="text-sm text-fg-muted px-3 py-6 text-center">Quiet on the agent feeds. Triggers update here as soon as agents act.</div>
            )}
            {data.agentFeed.map((e) => (
              <div key={e.id} className="rounded-lg border border-border bg-bg-elevated/40 px-2.5 py-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{e.agent}</span>
                  <span className="text-fg-muted">{new Date(e.createdAt).toLocaleTimeString()}</span>
                </div>
                <div className="truncate text-fg-muted">{e.reason ?? `decision: ${e.decision}`}</div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* Fraud + Review */}
      <section className="grid lg:grid-cols-2 gap-4">
        <Card
          icon={<Shield className="h-4 w-4 text-danger" />}
          title="Fraud Sentinel alerts"
          subtitle="Auto-flagged by stream-farm, sybil, circular-payment, payout-abuse detectors"
          highlight={data.fraudAlerts.length > 0}
        >
          <div className="space-y-2 max-h-80 overflow-y-auto pr-2">
            {data.fraudAlerts.length === 0 && (
              <div className="text-sm text-fg-muted px-3 py-6 text-center">All clear. No active high-severity alerts.</div>
            )}
            {data.fraudAlerts.map((a) => (
              <button
                key={a.id}
                onClick={() => openExplanation(a.id)}
                className="flex w-full items-center gap-3 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-left transition hover:bg-danger/10"
              >
                <div className="flex-shrink-0">
                  <Badge variant="danger">{a.severity}</Badge>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {a.entityType} · <span className="text-fg-muted">{a.entityId.slice(0, 10)}…</span>
                  </div>
                  <div className="text-xs text-fg-muted truncate">{a.reasons[0]}</div>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-xs tabular-nums">{a.score}/100</span>
                  {a.autoActioned && <Badge variant="warning">auto: {a.autoAction}</Badge>}
                </div>
              </button>
            ))}
          </div>
        </Card>

        <Card icon={<Eye className="h-4 w-4 text-warning" />} title="Manual review queue">
          <div className="space-y-2 max-h-80 overflow-y-auto pr-2">
            {data.reviewQueue.length === 0 && (
              <div className="text-sm text-fg-muted px-3 py-6 text-center">No pending streams in review. Stream something risky to see this fill up.</div>
            )}
            {data.reviewQueue.map((r) => (
              <div key={r.id} className="rounded-xl border border-border bg-bg-elevated/40 px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{r.song.title}</div>
                    <div className="text-xs text-fg-muted truncate">
                      listener <span className="font-medium">@{r.user.username}</span> · classification {r.stream.classification}
                    </div>
                  </div>
                  <Badge variant="warning">{r.fraudScore}/100</Badge>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => decideReview(r.id, 'approve')}>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => decideReview(r.id, 'reject')}>
                    <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => decideReview(r.id, 'refund')}>
                    <DollarSign className="h-3.5 w-3.5 mr-1" /> Refund
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* Phase 8 — Streaming health */}
      <StreamingHealthCard />

      {/* Phase 9 — Payment health + settlement timeline */}
      <PaymentsHealthCard />

      <Card icon={<Cpu className="h-4 w-4 text-accent" />} title="Queue & worker health">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {data.queueStatus.map((q) => (
            <div key={q.name} className="rounded-xl border border-border bg-bg-elevated/40 px-3 py-2">
              <div className="text-xs font-mono truncate" title={q.name}>{q.name}</div>
              <div className="mt-1 flex items-center gap-2 text-xs">
                <span title="waiting" className="text-fg-muted">{q.waiting} waiting</span>
                <span title="active" className="text-accent">{q.active} active</span>
                {q.failed > 0 && <span title="failed" className="text-danger">{q.failed} failed</span>}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* AI Explainability modal */}
      <AnimatePresence>
        {selected && (
          <ExplainModal decision={selected} onClose={() => setSelected(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function ExplainModal({ decision, onClose }: { decision: DecisionDetail; onClose: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-border bg-bg-elevated p-6 shadow-2xl"
        initial={{ scale: 0.95, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 10 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-xs text-fg-muted uppercase tracking-wide">AI Explainability</div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Bot className="h-5 w-5 text-accent" />
              {decision.agent}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-bg-muted transition">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <Stat label="Decision" value={decision.decision} />
          <Stat label="Confidence" value={`${decision.confidence}%`} />
          <Stat label="Latency" value={`${decision.latencyMs ?? 0}ms`} />
        </div>

        <div className="space-y-4">
          <Section title="Reasons">
            <ul className="space-y-1">
              {decision.reasons.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <ChevronRight className="h-3 w-3 text-accent mt-1 flex-shrink-0" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </Section>

          {decision.categoryScores && (
            <Section title="Category scores">
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(decision.categoryScores as Record<string, number>).map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-bg-muted px-3 py-2">
                    <div className="text-xs text-fg-muted">{k}</div>
                    <div className="text-lg font-semibold tabular-nums">{typeof v === 'number' ? v.toFixed(2) : v}</div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {decision.inputs && (
            <Section title="Inputs (raw)">
              <pre className="text-xs overflow-x-auto rounded-lg bg-black/30 p-3 max-h-64 overflow-y-auto">
                {JSON.stringify(decision.inputs, null, 2)}
              </pre>
            </Section>
          )}

          <Section title="Audit trail">
            <div className="text-xs text-fg-muted space-y-0.5">
              <div>Decision log id: <span className="font-mono">{decision.id}</span></div>
              <div>Subject: {decision.subjectType}/{decision.subjectId}</div>
              <div>Created: {new Date(decision.createdAt).toISOString()}</div>
              <div>Agent version: {decision.version ?? 'v3'}</div>
            </div>
          </Section>
        </div>
      </motion.div>
    </motion.div>
  );
}

function badgeVariantForDecision(decision: string): 'success' | 'danger' | 'warning' | 'default' | 'accent' {
  if (['approved', 'completed', 'valid_stream', 'for_you', 'resolved'].includes(decision)) return 'success';
  if (['rejected', 'failed', 'fraudulent_stream'].includes(decision)) return 'danger';
  if (['needs_changes', 'manual_review', 'suspicious_stream'].includes(decision)) return 'warning';
  return 'default';
}

function Kpi({ label, value, icon, highlight }: { label: string; value: string; icon: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={cn(
      'rounded-2xl border p-4 transition',
      highlight ? 'border-danger/40 bg-danger/5' : 'border-border bg-bg-elevated',
    )}>
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-fg-muted">{label}</span>
        {icon}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function Card({ icon, title, subtitle, children, className, highlight, 'data-testid': dataTestid }: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  highlight?: boolean;
  'data-testid'?: string;
}) {
  return (
    <div
      data-testid={dataTestid}
      className={cn(
        'rounded-2xl border bg-bg-elevated/60 p-4',
        highlight ? 'border-danger/30' : 'border-border',
        className,
      )}
    >
      <div className="mb-3">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="font-semibold">{title}</h3>
        </div>
        {subtitle && <div className="text-xs text-fg-muted mt-0.5">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-fg-muted mb-2">{title}</div>
      {children}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl bg-bg-muted px-3 py-2 text-center">
      <div className="text-[10px] uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function AdminSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-4 md:px-8 py-6 space-y-4">
      <Skeleton className="h-10 w-1/3" />
      <div className="grid grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

// ─── Phase 9 — Payment Health ─────────────────────────────────

interface PaymentsHealth {
  paymentsPending: number;
  paymentsConfirmed: number;
  paymentsFailed: number;
  avgSettlementLatencyMs: number;
  webhookLagMs: number | null;
  balanceDriftCount: number;
  settlementFailureCount: number;
  walletReconcile: {
    lastRunAt: string | null;
    walletsChecked: number;
    driftDetected: number;
    driftRepaired: number;
  };
  timestamp: string;
}

function PaymentsHealthCard() {
  const [h, setH] = useState<PaymentsHealth | null>(null);
  const [recent, setRecent] = useState<Array<{ id: string; amountUsdc: string; status: string; createdAt: string }>>([]);
  useEffect(() => {
    const fetchIt = () => Promise.all([
      fetch('/api/admin/payments-health').then((r) => r.json()),
      fetch('/api/admin/recent-payments').then((r) => r.json()).catch(() => ({ payments: [] })),
    ]).then(([health, rec]) => {
      setH(health as PaymentsHealth);
      setRecent((rec as { payments: Array<{ id: string; amountUsdc: string; status: string; createdAt: string }> }).payments);
    }).catch(() => undefined);
    fetchIt();
    const t = setInterval(fetchIt, 5_000);
    return () => clearInterval(t);
  }, []);
  if (!h) {
    return (
      <Card icon={<DollarSign className="h-4 w-4 text-accent" />} title="Payment health (Phase 9)">
        <Skeleton className="h-32 w-full" />
      </Card>
    );
  }
  return (
    <Card icon={<DollarSign className="h-4 w-4 text-accent" />} title="Payment health (Phase 9)">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        <Stat label="Pending" value={String(h.paymentsPending)} />
        <Stat label="Confirmed (24h)" value={String(h.paymentsConfirmed)} highlight />
        <Stat label="Failed (24h)" value={String(h.paymentsFailed)} highlight={h.paymentsFailed > 0} />
        <Stat label="Avg settlement" value={`${h.avgSettlementLatencyMs}ms`} />
        <Stat label="Webhook lag" value={h.webhookLagMs == null ? '—' : `${Math.round(h.webhookLagMs / 1000)}s`} />
        <Stat label="Balance drift (24h)" value={String(h.balanceDriftCount)} />
        <Stat label="Settle failures (24h)" value={String(h.settlementFailureCount)} />
      </div>
      {recent.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="text-xs uppercase tracking-wide text-fg-muted">Recent settlements</div>
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-2">
            {recent.slice(0, 5).map((p) => (
              <details key={p.id} className="rounded-xl border border-border bg-bg-elevated/40 p-2">
                <summary className="flex cursor-pointer items-center justify-between text-xs">
                  <span className="flex items-center gap-2">
                    <Badge variant={p.status === 'settled' ? 'success' : p.status === 'failed' ? 'danger' : 'warning'}>
                      {p.status}
                    </Badge>
                    <span className="tabular-nums">{p.amountUsdc} USDC</span>
                  </span>
                  <span className="text-fg-muted">{new Date(p.createdAt).toLocaleTimeString()}</span>
                </summary>
                <div className="mt-2">
                  <SettlementTimeline paymentId={p.id} />
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

interface StreamingHealth {
  payment_due_per_min: number;
  payment_settled_per_min: number;
  socket_disconnect_per_min: number;
  suspicious_streams_per_min: number;
  activeStreams: number;
  chargedPerMin: number;
  suspiciousPerMin: number;
  uniqueListenersLast5Min: number;
  recentStreamCount5Min: number;
  timestamp: string;
}

function StreamingHealthCard() {
  const [h, setH] = useState<StreamingHealth | null>(null);
  useEffect(() => {
    const fetchIt = () => fetch('/api/admin/streaming-health').then((r) => r.json()).then(setH).catch(() => undefined);
    fetchIt();
    const t = setInterval(fetchIt, 5_000);
    return () => clearInterval(t);
  }, []);
  if (!h) {
    return (
      <Card icon={<Activity className="h-4 w-4 text-accent" />} title="Streaming health">
        <Skeleton className="h-24 w-full" />
      </Card>
    );
  }
  return (
    <Card icon={<Activity className="h-4 w-4 text-accent" />} title="Streaming health (Phase 8)" data-testid="streaming-health-card">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        <Stat label="Active streams" value={String(h.activeStreams)} />
        <Stat label="Listeners (5m)" value={String(h.uniqueListenersLast5Min)} />
        <Stat label="Payment due /m" value={String(h.payment_due_per_min)} />
        <Stat label="Payment settled /m" value={String(h.payment_settled_per_min)} />
        <Stat label="Charged /m" value={String(h.chargedPerMin)} />
        <Stat label="Suspicious /m" value={String(h.suspiciousPerMin)} />
        <Stat label="Socket disconnect /m" value={String(h.socket_disconnect_per_min)} />
        <Stat label="Stream starts (5m)" value={String(h.recentStreamCount5Min)} />
      </div>
    </Card>
  );
}

interface DecisionDetail {
  id: string;
  agent: string;
  subjectType: string;
  subjectId: string;
  decision: string;
  confidence: number;
  reasons: string[];
  categoryScores?: Record<string, number> | null;
  inputs?: Record<string, unknown> | null;
  latencyMs?: number | null;
  createdAt: string;
  version?: string | null;
}