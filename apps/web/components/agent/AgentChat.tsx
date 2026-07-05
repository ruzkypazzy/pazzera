'use client';
/**
 * AgentChat — the conversational upload agent's UI.
 *
 * Mounted inside the existing UploadDialog. Communicates with the
 * /api/agent/upload/{message,commit} routes.
 *
 * The agent never replaces the manual form. There's a "Switch to manual"
 * button at the top that closes this chat and lets the artist use the
 * existing 4-step form.
 *
 * Phase 3 polish:
 * - Cmd/Ctrl+Enter shortcut to send
 * - Inline error with retry button (clears on next attempt)
 * - Reset clears errors too
 * - Better "Thinking…" placement (right above input, not below)
 * - Success card auto-scrolls into view + stays visible
 * - Drop hint shown when an audio file is dragged over the area
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Music, Image as ImageIcon, Upload, Loader2, CheckCircle2, AlertCircle, Sparkles, RefreshCw, Pencil, Repeat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { MessageBubble, type AgentBubbleData } from './MessageBubble';

type Health = { ok: boolean; provider: string; model: string; reason?: string };

type Session = {
  id: string;
  state: {
    state: 'idle' | 'awaiting_audio' | 'awaiting_cover' | 'awaiting_decision' | 'committing' | 'committed' | 'error';
    draft: {
      title?: string;
      description?: string;
      moodTags?: string[];
      audioQuality?: 'low' | 'mid' | 'high';
      confidence?: 'low' | 'mid' | 'high';
      reasoning?: string;
      streamRateUsdc?: number;
      recipients?: Array<{
        username: string;
        role: 'primary_artist' | 'featured_artist' | 'producer' | 'songwriter' | 'label' | 'custom';
        percentageBps: number;
        type: 'internal' | 'external';
        externalWalletAddress?: string;
        externalLabel?: string;
        resolvedUserId?: string;
        resolution?: 'ok' | 'not_found' | 'external';
      }>;
      audioFileName?: string;
      coverFileName?: string;
    };
  };
  messages: AgentBubbleData[];
};

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name}=`));
  return m?.split('=')[1] ?? null;
}

export function AgentChat({ onSwitchToManual, onCommitSuccess }: { onSwitchToManual?: () => void; onCommitSuccess?: (songId: string) => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFailedInput, setLastFailedInput] = useState<{ input: Record<string, unknown>; files: Record<string, File | null> } | null>(null);
  const [commitResult, setCommitResult] = useState<{ songId: string; slug: string | null } | null>(null);
  const [isDraggingAudio, setIsDraggingAudio] = useState(false);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load most recent open session on mount. If none exists, create one
  // by hitting POST with a no-op input so the server's greeting message
  // gets generated and the panel shows the welcome state.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/agent/upload/message', { credentials: 'include' });
        const j = await r.json();
        if (j.ok) {
          setHealth(j.health);
          if (j.session) {
            setSession(j.session);
          } else {
            // No open session — create one by sending a probe message.
            // Server will populate the initial greeting.
            await post({ kind: 'text', text: 'hi' });
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Network error');
      }
    })();
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      // Smooth-scroll only if user is already near the bottom (don't yank them away)
      const el = scrollRef.current;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      if (nearBottom) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      }
    }
  }, [session?.messages.length, busy, commitResult]);

  // Cmd/Ctrl+Enter to send
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!busy && text.trim()) {
          const t = text.trim();
          setText('');
          void post({ kind: 'text', text: t });
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, text, session?.id]);

  const post = useCallback(
    async (input: Record<string, unknown>, files: Record<string, File | null> = {}) => {
      setBusy(true);
      setError(null);
      try {
        const hasFiles = Object.values(files).some(Boolean);
        let r: Response;
        if (hasFiles) {
          const fd = new FormData();
          fd.append('sessionId', session?.id ?? '');
          fd.append('input', JSON.stringify(input));
          for (const [k, v] of Object.entries(files)) {
            if (v) fd.append(k, v);
          }
          r = await fetch('/api/agent/upload/message', {
            method: 'POST',
            body: fd,
            credentials: 'include',
            headers: { 'x-csrf-token': getCookie('csrf') ?? '' },
          });
        } else {
          r = await fetch('/api/agent/upload/message', {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json', 'x-csrf-token': getCookie('csrf') ?? '' },
            body: JSON.stringify({ sessionId: session?.id ?? null, input }),
          });
        }
        const j = await r.json();
        if (!r.ok || !j.ok) {
          throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
        }
        setSession(j.session);
        setLastFailedInput(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        setError(msg);
        setLastFailedInput({ input, files });
      } finally {
        setBusy(false);
      }
    },
    [session?.id],
  );

  async function commit() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/agent/upload/commit', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': getCookie('csrf') ?? '' },
        body: JSON.stringify({ sessionId: session.id }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
      }
      setCommitResult({ songId: j.songId, slug: j.slug });
      onCommitSuccess?.(j.songId);
      // Fire a follow-up text message so the agent acknowledges the
      // submission in chat. The session is closed server-side, but
      // posting here keeps the user's history visible AND triggers
      // the agent to reply before the dialog auto-closes.
      try {
        await post({ kind: 'text', text: 'submitted' });
      } catch {
        // Non-fatal — success card still shows.
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Commit failed');
    } finally {
      setBusy(false);
    }
  }

  function onSend() {
    const t = text.trim();
    if (!t) return;
    setText('');
    void post({ kind: 'text', text: t });
  }

  async function onAudioChosen(file: File | null) {
    if (!file) return;
    void post({ kind: 'audio' }, { audioFile: file });
  }
  async function onCoverChosen(file: File | null) {
    if (!file) return;
    void post({ kind: 'cover' }, { coverFile: file });
  }

  async function onApplyDecision(d: { title: string; description: string; moodTags: string[]; streamRateUsdc: number }) {
    void post({ kind: 'rate', streamRateUsdc: d.streamRateUsdc });
  }

  function onRetry() {
    if (!lastFailedInput) return;
    void post(lastFailedInput.input, lastFailedInput.files);
  }

  async function reset() {
    setError(null);
    setLastFailedInput(null);
    setCommitResult(null);
    void post({ kind: 'reset' });
  }

  const state = session?.state.state ?? 'idle';
  const draft = session?.state.draft;
  const messages = session?.messages ?? [];
  const isOffline = health != null && !health.ok;

  return (
    <div
      className={cn(
        'flex h-[60vh] min-h-[480px] flex-col rounded-2xl border bg-bg overflow-hidden transition',
        isDraggingAudio ? 'border-[#00D4AA] ring-2 ring-[#00D4AA]/30' : 'border-border',
      )}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault();
          setIsDraggingAudio(true);
        }
      }}
      onDragLeave={() => setIsDraggingAudio(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingAudio(false);
        const file = e.dataTransfer?.files?.[0];
        if (!file) return;
        if (file.type.startsWith('audio/')) {
          void onAudioChosen(file);
        } else if (file.type.startsWith('image/')) {
          void onCoverChosen(file);
        }
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-bg-elevated px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#00D4AA]/15">
            <Sparkles className="h-3.5 w-3.5 text-[#00D4AA]" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">AI Upload Agent</div>
            <div className="flex items-center gap-1.5 text-[10px] text-fg-muted">
              {health ? (
                <>
                  <span className={cn('h-1.5 w-1.5 rounded-full', health.ok ? 'bg-accent' : 'bg-warning')} />
                  <span>{health.ok ? `${health.model} ready` : `Offline · ${health.reason ?? 'fallback mode'}`}</span>
                </>
              ) : (
                <span>Connecting…</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={reset} className="h-7 text-xs" title="Start over with a fresh session">
            <RefreshCw className="h-3 w-3 mr-1" /> Reset
          </Button>
          {onSwitchToManual && (
            <Button variant="secondary" size="sm" onClick={onSwitchToManual} className="h-7 text-xs" title="Use the classic 4-step form">
              <Pencil className="h-3 w-3 mr-1" /> Switch to manual
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !busy && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading your agent session…</span>
          </div>
        )}
        <AnimatePresence>
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              msg={m}
              onApplyDecision={m.kind === 'decision_proposed' ? onApplyDecision : undefined}
            />
          ))}
        </AnimatePresence>
        {commitResult && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-accent/30 bg-accent/5 p-4 text-sm space-y-1"
          >
            <div className="flex items-center gap-2 font-semibold text-accent">
              <CheckCircle2 className="h-4 w-4" />
              Submitted to Curator ✓
            </div>
            <div className="text-xs text-fg-muted">
              Your track has been queued for curator review. Audio, cover and splits are locked in.
            </div>
            <div className="text-xs text-fg-muted">
              Song ID <span className="font-mono">{commitResult.songId}</span>
              {commitResult.slug && <> · slug <span className="font-mono">{commitResult.slug}</span></>}
            </div>
            <div className="text-xs text-fg-muted">The new track will appear publicly once the curator approves it.</div>
          </motion.div>
        )}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger flex items-start gap-2"
          >
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-none" />
            <div className="flex-1 min-w-0">
              <div className="font-medium mb-1">Something went wrong</div>
              <div className="text-danger/80 break-words">{error}</div>
              {lastFailedInput && (
                <button
                  onClick={onRetry}
                  className="mt-2 inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/10 px-2 py-1 text-[11px] font-medium text-danger hover:bg-danger/20 transition"
                >
                  <Repeat className="h-3 w-3" /> Retry
                </button>
              )}
            </div>
          </motion.div>
        )}
      </div>

      {/* Quick action chips for current state */}
      <div className="border-t border-border bg-bg-elevated px-4 py-2.5 space-y-2">
        {state === 'idle' && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => onAudioChosen(e.target.files?.[0] ?? null)}
            />
            <Button size="sm" onClick={() => audioInputRef.current?.click()} disabled={busy}>
              <Music className="h-3.5 w-3.5 mr-1.5" /> Drop audio
            </Button>
            <span className="text-[11px] text-fg-muted">drag & drop anywhere · or type a message below</span>
          </div>
        )}
        {state === 'awaiting_audio' && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => onAudioChosen(e.target.files?.[0] ?? null)}
            />
            <Button size="sm" variant="secondary" onClick={() => audioInputRef.current?.click()} disabled={busy}>
              <Music className="h-3.5 w-3.5 mr-1.5" /> Pick audio file
            </Button>
            <span className="text-[11px] text-fg-muted">waiting for your audio file</span>
          </div>
        )}
        {state === 'awaiting_cover' && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onCoverChosen(e.target.files?.[0] ?? null)}
            />
            <Button size="sm" onClick={() => coverInputRef.current?.click()} disabled={busy}>
              <ImageIcon className="h-3.5 w-3.5 mr-1.5" /> Drop cover art
            </Button>
            <span className="text-[11px] text-fg-muted">drop anywhere · or pick a file</span>
          </div>
        )}
        {state === 'awaiting_decision' && draft && (
          <div className="space-y-2">
            <div className="rounded-xl border border-border bg-bg p-2 space-y-1.5">
              <div className="text-[10px] uppercase tracking-widest text-fg-muted px-1">Recipients</div>
              {(draft.recipients ?? []).map((r, i) => (
                <RecipientRow
                  key={i}
                  index={i}
                  recipient={r}
                  disabled={busy}
                  onUsername={(u) => void post({ kind: 'recipient_username', index: i, username: u })}
                  onPct={(p) => void post({ kind: 'recipient_pct', index: i, percentageBps: p })}
                />
              ))}
              <RateRow
                rate={draft.streamRateUsdc ?? 0.003}
                disabled={busy}
                onRate={(r) => void post({ kind: 'rate', streamRateUsdc: r })}
              />
            </div>
            <Button
              size="sm"
              className="w-full"
              onClick={commit}
              disabled={busy || commitResult != null}
            >
              <Upload className="h-3.5 w-3.5 mr-1.5" /> Publish to Pazzera
            </Button>
          </div>
        )}
        {state === 'committing' && (
          <div className="text-[11px] text-fg-muted flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            Uploading audio + cover to Pazzera…
          </div>
        )}
        {state === 'committed' && (
          <div className="text-[11px] text-accent flex items-center gap-2">
            <CheckCircle2 className="h-3 w-3" /> Done. Your track is queued for curator review.
          </div>
        )}
      </div>

      {/* Text input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
        className="flex items-center gap-2 border-t border-border bg-bg px-3 py-2.5"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message — title, edits, rate changes… (⌘/Ctrl+Enter)"
          className="flex-1 rounded-xl border border-border bg-bg-elevated px-3 py-1.5 text-sm text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4AA]/30"
          disabled={busy}
        />
        {busy && <Loader2 className="h-4 w-4 animate-spin text-[#00D4AA]" />}
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#00D4AA] text-bg disabled:opacity-40 transition"
          aria-label="Send"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}

function RecipientRow({ index, recipient, disabled, onUsername, onPct }: {
  index: number;
  recipient: { username: string; role: string; percentageBps: number; resolution?: 'ok' | 'not_found' | 'external' };
  disabled: boolean;
  onUsername: (u: string) => void;
  onPct: (bps: number) => void;
}) {
  const isLocked = recipient.role === 'primary_artist';
  return (
    <div className="grid grid-cols-[1fr_70px_24px] gap-1.5 items-center px-1">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-fg-muted w-16 flex-none">{recipient.role.replace(/_/g, ' ')}</span>
        <input
          value={recipient.username}
          placeholder={isLocked ? '(you)' : '@username'}
          disabled={isLocked || disabled}
          onChange={(e) => onUsername(e.target.value)}
          className={cn(
            'flex-1 rounded-md border bg-bg px-2 py-1 text-xs',
            recipient.resolution === 'not_found' ? 'border-warning/50 text-warning' : 'border-border text-fg',
          )}
        />
      </div>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          max={100}
          value={Math.round(recipient.percentageBps / 100)}
          disabled={disabled}
          onChange={(e) => onPct(Math.round(Number(e.target.value) * 100))}
          className="w-12 rounded-md border border-border bg-bg px-1.5 py-1 text-xs text-right tabular-nums text-fg"
        />
        <span className="text-[10px] text-fg-muted">%</span>
      </div>
      <div className="flex items-center justify-center">
        {recipient.resolution === 'ok' && <CheckCircle2 className="h-3 w-3 text-accent" />}
        {recipient.resolution === 'not_found' && <AlertCircle className="h-3 w-3 text-warning" />}
      </div>
    </div>
  );
}

function RateRow({ rate, disabled, onRate }: { rate: number; disabled: boolean; onRate: (n: number) => void }) {
  const preset = [0.001, 0.002, 0.003, 0.004, 0.005];
  return (
    <div className="flex items-center gap-2 px-1 pt-1 border-t border-border/40">
      <span className="text-[10px] text-fg-muted w-16 flex-none">Rate</span>
      <input
        type="number"
        step={0.001}
        min={0.001}
        max={0.005}
        value={rate.toFixed(3)}
        disabled={disabled}
        onChange={(e) => onRate(Math.max(0.001, Math.min(0.005, Number(e.target.value))))}
        className="w-20 rounded-md border border-border bg-bg px-2 py-1 text-xs tabular-nums text-fg"
      />
      <span className="text-[10px] text-fg-muted">USDC / stream</span>
      <div className="flex gap-0.5 ml-auto">
        {preset.map((p) => (
          <button
            key={p}
            type="button"
            disabled={disabled}
            onClick={() => onRate(p)}
            className={cn(
              'rounded px-1.5 py-0.5 text-[9px] tabular-nums transition',
              Math.abs(rate - p) < 0.0005
                ? 'bg-[#00D4AA]/20 text-[#00D4AA] border border-[#00D4AA]/40'
                : 'text-fg-muted border border-transparent hover:border-border',
            )}
            title={`${p} USDC per stream`}
          >
            {p.toFixed(3)}
          </button>
        ))}
      </div>
    </div>
  );
}