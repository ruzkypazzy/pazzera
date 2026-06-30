'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Users, Music, DollarSign, Activity, AlertTriangle, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

interface AdminData {
  metrics: {
    totalUsers: number;
    activeListeners: number;
    artists: number;
    streamsToday: number;
    totalUsdcVolume: string;
  };
  agentFeed: {
    id: string;
    agent: string;
    subjectType: string | null;
    subjectId: string | null;
    decision: string;
    reason: string | null;
    createdAt: string;
  }[];
  riskEvents: { id: string; type: string; severity: number; meta: Record<string, unknown> | null; createdAt: string }[];
  queueStatus: { name: string; waiting: number; active: number; failed: number; delayed: number }[];
}

export function AdminDashboard() {
  const [data, setData] = useState<AdminData | null>(null);

  useEffect(() => {
    fetch('/api/admin/overview')
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) return <AdminSkeleton />;

  return (
    <div className="mx-auto max-w-7xl px-4 md:px-8 py-6 space-y-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">System intelligence</h1>
        <p className="text-fg-muted text-sm mt-1">Live view of every agent, queue, and risk signal on Pazzera.</p>
      </header>

      {/* Platform metrics */}
      <section className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi label="Total users" value={String(data.metrics.totalUsers)} icon={<Users className="h-4 w-4 text-accent" />} />
        <Kpi label="Active listeners" value={String(data.metrics.activeListeners)} icon={<Activity className="h-4 w-4 text-accent" />} />
        <Kpi label="Artists" value={String(data.metrics.artists)} icon={<Music className="h-4 w-4 text-accent" />} />
        <Kpi label="Streams today" value={String(data.metrics.streamsToday)} icon={<Music className="h-4 w-4 text-accent" />} />
        <Kpi label="Total USDC volume" value={`${Number(data.metrics.totalUsdcVolume).toFixed(2)}`} icon={<DollarSign className="h-4 w-4 text-accent" />} accent />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Agent activity feed */}
        <div className="rounded-2xl border border-border bg-bg-elevated p-5">
          <div className="flex items-center gap-2 text-xs text-fg-muted uppercase tracking-wider mb-3">
            <Activity className="h-4 w-4" /> Agent activity feed
          </div>
          <div className="space-y-2 max-h-96 overflow-y-auto scrollbar-thin pr-2">
            {data.agentFeed.length === 0 && <div className="text-sm text-fg-muted">No recent activity.</div>}
            {data.agentFeed.map((e, i) => (
              <motion.div
                key={e.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.02 }}
                className="flex items-center gap-3 rounded-xl border border-border bg-bg-elevated/50 p-3 text-sm"
              >
                <AgentIcon agent={e.agent} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">
                    <span className="capitalize">{e.agent}</span> · <span className="text-fg-muted">{e.decision}</span>
                  </div>
                  {e.reason && <div className="text-xs text-fg-muted truncate">{e.reason}</div>}
                </div>
                <div className="text-xs text-fg-muted">{timeAgo(e.createdAt)}</div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Risk monitoring */}
        <div className="rounded-2xl border border-border bg-bg-elevated p-5">
          <div className="flex items-center gap-2 text-xs text-fg-muted uppercase tracking-wider mb-3">
            <AlertTriangle className="h-4 w-4 text-warning" /> Risk monitoring
          </div>
          <div className="space-y-2 max-h-96 overflow-y-auto scrollbar-thin pr-2">
            {data.riskEvents.length === 0 && <div className="text-sm text-fg-muted">No risk events in the last 24h.</div>}
            {data.riskEvents.map((e) => (
              <div key={e.id} className="flex items-center gap-3 rounded-xl border border-border bg-bg-elevated/50 p-3 text-sm">
                <div className={cn('h-2 w-2 rounded-full', severityColor(e.severity))} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium capitalize">{e.type.replace(/_/g, ' ')}</div>
                  <div className="text-xs text-fg-muted">severity {e.severity}/100</div>
                </div>
                <div className="text-xs text-fg-muted">{timeAgo(e.createdAt)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Queue status */}
      <section className="rounded-2xl border border-border bg-bg-elevated p-5">
        <div className="flex items-center gap-2 text-xs text-fg-muted uppercase tracking-wider mb-3">
          <Clock className="h-4 w-4" /> Queue status
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {data.queueStatus.map((q) => (
            <div key={q.name} className="rounded-xl border border-border bg-bg-elevated/50 p-3">
              <div className="text-xs text-fg-muted font-mono">{q.name}</div>
              <div className="mt-2 flex items-center gap-2 text-sm">
                <Badge variant="glass">{q.waiting} waiting</Badge>
                <Badge variant="accent">{q.active} active</Badge>
                {q.failed > 0 && <Badge variant="danger">{q.failed} failed</Badge>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent?: boolean }) {
  return (
    <div className={cn('rounded-2xl border p-4', accent ? 'border-accent/30 bg-accent/5' : 'border-border bg-bg-elevated')}>
      <div className="flex items-center gap-2 text-xs text-fg-muted uppercase tracking-wider">
        {icon} {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function AgentIcon({ agent }: { agent: string }) {
  if (agent === 'curator') return <CheckCircle2 className="h-4 w-4 text-accent" />;
  if (agent === 'fan') return <Activity className="h-4 w-4 text-warning" />;
  if (agent === 'split') return <DollarSign className="h-4 w-4 text-accent" />;
  return <XCircle className="h-4 w-4 text-fg-muted" />;
}

function severityColor(s: number) {
  if (s >= 80) return 'bg-danger';
  if (s >= 50) return 'bg-warning';
  return 'bg-fg-muted';
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function AdminSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}