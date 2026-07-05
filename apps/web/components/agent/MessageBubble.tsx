'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, User as UserIcon, Music, Image as ImageIcon, AlertCircle, Loader2, CheckCircle2, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export type AgentBubbleData = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  kind:
    | 'greeting'
    | 'chat'
    | 'audio_analyzed'
    | 'cover_analyzed'
    | 'decision_proposed'
    | 'recipient_resolved'
    | 'recipient_unresolved'
    | 'commit_preview'
    | 'commit_done'
    | 'fallback_notice'
    | 'error';
  text: string;
  payload?: Record<string, unknown>;
  createdAt: string;
};

function isDecisionProposed(d: AgentBubbleData): d is AgentBubbleData & { payload: { decision: { title: string; description: string; moodTags: string[]; audioQuality: 'low' | 'mid' | 'high'; confidence: 'low' | 'mid' | 'high'; reasoning: string; streamRateUsdc: number } } } {
  return d.kind === 'decision_proposed' && !!d.payload?.decision;
}

function isAudioAnalyzed(d: AgentBubbleData): boolean {
  return d.kind === 'audio_analyzed';
}

export function MessageBubble({ msg, onRecipientUsernameEdit, onRecipientPctEdit, onRateEdit, onApplyDecision }: {
  msg: AgentBubbleData;
  onRecipientUsernameEdit?: (index: number, username: string) => void;
  onRecipientPctEdit?: (index: number, bps: number) => void;
  onRateEdit?: (rate: number) => void;
  onApplyDecision?: (decision: { title: string; description: string; moodTags: string[]; streamRateUsdc: number }) => void;
}) {
  const isUser = msg.role === 'user';
  const isAssistant = msg.role === 'assistant';
  const Icon = isUser ? UserIcon : isAssistant ? Sparkles : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('flex gap-2.5', isUser ? 'flex-row-reverse' : 'flex-row')}
    >
      <div
        className={cn(
          'flex h-7 w-7 flex-none items-center justify-center rounded-full text-xs',
          isUser
            ? 'bg-bg-muted text-fg-muted'
            : msg.kind === 'error'
              ? 'bg-danger/15 text-danger'
              : 'bg-[#00D4AA]/15 text-[#00D4AA]',
        )}
      >
        {Icon ? <Icon className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
      </div>
      <div
        className={cn(
          'flex-1 min-w-0 max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm',
          isUser
            ? 'bg-bg-muted text-fg'
            : msg.kind === 'error'
              ? 'border border-danger/30 bg-danger/10 text-danger'
              : 'border border-border bg-bg-elevated text-fg',
        )}
      >
        {/* Audio analyzed: special inline summary */}
        {isAudioAnalyzed(msg) && (
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            <Music className="h-3.5 w-3.5" />
            <span>{(msg.payload?.analysis as { format?: string; durationSeconds?: number; bitrateKbps?: number; energy?: string })?.format ?? '?'} · {((msg.payload?.analysis as { durationSeconds?: number })?.durationSeconds ?? 0).toFixed(1)}s · {((msg.payload?.analysis as { bitrateKbps?: number })?.bitrateKbps) ?? '?'} kbps · <span className="text-[#00D4AA]">{((msg.payload?.analysis as { energy?: string })?.energy) ?? '?'} energy</span></span>
          </div>
        )}

        {/* Cover caption: special inline */}
        {msg.kind === 'cover_analyzed' && msg.payload?.caption && (
          <div className="mt-1 flex items-center gap-2 text-xs text-fg-muted">
            <ImageIcon className="h-3.5 w-3.5" />
            <span className="italic">{(msg.payload as { caption: string }).caption}</span>
          </div>
        )}

        {/* Decision proposed: rich card */}
        {isDecisionProposed(msg) && (
          <div className="mt-1 space-y-3">
            <div className="rounded-xl border border-[#00D4AA]/25 bg-[#00D4AA]/5 p-3 space-y-2.5">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-fg-muted">Title</div>
                <div className="font-semibold text-base">{msg.payload.decision.title}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-fg-muted">Description</div>
                <div className="text-sm text-fg">{msg.payload.decision.description}</div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {msg.payload.decision.moodTags.map((m) => (
                  <span key={m} className="rounded-full border border-border bg-bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-fg-muted">{m}</span>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Stat label="Stream rate" value={`${msg.payload.decision.streamRateUsdc.toFixed(3)} USDC`} />
                <Stat label="Audio quality" value={msg.payload.decision.audioQuality} />
                <Stat label="Confidence" value={msg.payload.decision.confidence} />
                <Stat label="Engine" value="gpt-4o-mini" />
              </div>
              <div className="border-t border-border/50 pt-2 text-[11px] text-fg-muted italic">
                <strong className="text-fg not-italic">Why this rate?</strong> {msg.payload.decision.reasoning}
              </div>
            </div>
            {onApplyDecision && (
              <button
                onClick={() => onApplyDecision(msg.payload.decision)}
                className="w-full rounded-xl border border-[#00D4AA]/40 bg-[#00D4AA]/15 px-3 py-2 text-sm font-medium text-[#00D4AA] hover:bg-[#00D4AA]/25 transition"
              >
                ✨ Use this metadata
              </button>
            )}
          </div>
        )}

        {/* Recipient resolved/unresolved inline */}
        {(msg.kind === 'recipient_resolved' || msg.kind === 'recipient_unresolved') && (
          <div className="mt-1 text-xs">
            <span className={msg.kind === 'recipient_resolved' ? 'text-accent' : 'text-warning'}>
              {(msg.payload as { username: string })?.username ?? msg.text}
            </span>
          </div>
        )}

        {/* Plain text */}
        {msg.text && msg.kind !== 'decision_proposed' && (
          <div className={cn('whitespace-pre-wrap', msg.text.length > 0 ? 'leading-relaxed' : '')}>{msg.text}</div>
        )}
      </div>
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-fg-muted">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}