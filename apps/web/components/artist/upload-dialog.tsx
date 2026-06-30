'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Music, Image as ImageIcon, Check, Plus, X, Info } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

interface Recipient {
  username: string;
  role: 'primary_artist' | 'featured_artist' | 'producer' | 'songwriter' | 'label' | 'custom';
  percentageBps: number; // 10000 = 100%
}

const ROLE_LABELS: Record<Recipient['role'], string> = {
  primary_artist: 'Primary artist',
  featured_artist: 'Featured',
  producer: 'Producer',
  songwriter: 'Songwriter',
  label: 'Label',
  custom: 'Custom',
};

export function UploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (b: boolean) => void }) {
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [genre, setGenre] = useState('house');
  const [price, setPrice] = useState('0.003');
  const [recipients, setRecipients] = useState<Recipient[]>([
    { username: '', role: 'primary_artist', percentageBps: 7000 },
    { username: '', role: 'featured_artist', percentageBps: 2000 },
    { username: '', role: 'producer', percentageBps: 1000 },
  ]);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [coverName, setCoverName] = useState<string | null>(null);

  const totalBps = recipients.reduce((s, r) => s + r.percentageBps, 0);
  const validSplit = totalBps === 10000;
  const priceValid = Number(price) >= 0.001 && Number(price) <= 0.005;
  const canAdvance = step === 1 ? title.length >= 3 : step === 2 ? recipients.every((r) => r.username.length >= 1) && validSplit : true;
  const canSubmit = step === 4 && validSplit && priceValid && audioName && coverName && title;

  function updateRecipient(i: number, patch: Partial<Recipient>) {
    setRecipients((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeRecipient(i: number) {
    setRecipients((prev) => prev.filter((_, idx) => idx !== i));
  }
  function addRecipient() {
    setRecipients((prev) => [...prev, { username: '', role: 'custom', percentageBps: 0 }]);
  }

  function submit() {
    // Phase 5 placeholder — real upload lands in Phase 6 (R2 + metadata).
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload music</DialogTitle>
          <DialogDescription>
            We&apos;ll review your track with the Curator Agent and publish it to the catalog.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1 mb-4">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className={cn(
                'h-1 flex-1 rounded-full transition',
                n <= step ? 'bg-accent' : 'bg-bg-muted',
              )}
            />
          ))}
        </div>

        {step === 1 && (
          <Section title="Basic info" hint="What should we call this track?">
            <Field label="Song title">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Midnight Protocol" />
            </Field>
            <Field label="Description (optional)">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A short description that helps the Curator agent understand the track."
                className="flex min-h-[80px] w-full rounded-xl border border-border bg-bg-elevated px-4 py-2 text-sm text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Genre">
                <Input value={genre} onChange={(e) => setGenre(e.target.value)} />
              </Field>
              <Field label="Language">
                <Input placeholder="English" defaultValue="English" />
              </Field>
            </div>
          </Section>
        )}

        {step === 2 && (
          <Section title="Credits & royalty splits" hint="Splits must total exactly 100%.">
            <div className="space-y-2">
              {recipients.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_140px_90px_auto] gap-2 items-center rounded-xl border border-border bg-bg-elevated p-2">
                  <Input
                    placeholder="Pazzera username"
                    value={r.username}
                    onChange={(e) => updateRecipient(i, { username: e.target.value })}
                  />
                  <select
                    value={r.role}
                    onChange={(e) => updateRecipient(i, { role: e.target.value as Recipient['role'] })}
                    className="h-11 rounded-xl border border-border bg-bg-elevated px-3 text-sm"
                  >
                    {Object.entries(ROLE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={(r.percentageBps / 100).toString()}
                      onChange={(e) => updateRecipient(i, { percentageBps: Math.round(Number(e.target.value) * 100) })}
                    />
                    <span className="text-fg-muted text-xs">%</span>
                  </div>
                  <button
                    onClick={() => removeRecipient(i)}
                    className="rounded-lg p-2 text-fg-muted hover:text-danger hover:bg-danger/10 transition"
                    aria-label="Remove"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <Button variant="ghost" size="sm" onClick={addRecipient} className="w-full">
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Add recipient
              </Button>
            </div>
            <div className="mt-3 flex items-center justify-between rounded-xl border border-border bg-bg-elevated p-3">
              <div className="text-xs text-fg-muted">Total</div>
              <Badge variant={validSplit ? 'success' : 'danger'}>
                {(totalBps / 100).toFixed(0)}% {validSplit ? '✓' : '(must equal 100%)'}
              </Badge>
            </div>
          </Section>
        )}

        {step === 3 && (
          <Section title="Media" hint="Audio mp3/wav/m4a · Cover jpg/png/webp.">
            <div className="grid grid-cols-2 gap-3">
              <FileDrop
                icon={<Music className="h-5 w-5" />}
                label="Audio file"
                filename={audioName}
                accept="audio/*"
                onFile={(f) => setAudioName(f?.name ?? null)}
              />
              <FileDrop
                icon={<ImageIcon className="h-5 w-5" />}
                label="Cover art"
                filename={coverName}
                accept="image/*"
                onFile={(f) => setCoverName(f?.name ?? null)}
              />
            </div>
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-border bg-bg-elevated p-3 text-xs text-fg-muted">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <p>
                Real upload lands in <strong className="text-fg">Phase 6</strong> with R2 presigned URLs +
                audio metadata extraction. For the demo, picking a file shows the UX flow.
              </p>
            </div>
          </Section>
        )}

        {step === 4 && (
          <Section title="Monetization" hint="Choose your per-stream price.">
            <Field label="Desired price per stream (USDC)">
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  step="0.001"
                  min={0.001}
                  max={0.005}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
                <span className="text-sm text-fg-muted">0.001 – 0.005</span>
              </div>
            </Field>
            <div className="rounded-2xl border border-accent/20 bg-accent/5 p-4 space-y-2">
              <div className="text-sm font-medium">Live split preview</div>
              <div className="text-xs text-fg-muted mb-2">At {price} USDC per stream:</div>
              <div className="space-y-1.5">
                {recipients.map((r, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="truncate">{r.username || <em className="text-fg-subtle">username</em>} <span className="text-fg-muted text-xs">· {ROLE_LABELS[r.role]}</span></span>
                    <span className="tabular-nums text-accent">
                      {((Number(price) * r.percentageBps) / 10000).toFixed(6)} USDC
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="text-xs text-fg-muted">
              Curator Agent may adjust your price based on quality scoring. You&apos;ll be notified of any change.
            </div>
          </Section>
        )}

        <div className="mt-6 flex items-center justify-between">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <Button variant="secondary" onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            )}
            {step < 4 ? (
              <Button onClick={() => setStep((s) => s + 1)} disabled={!canAdvance}>
                Next
              </Button>
            ) : (
              <Button onClick={submit} disabled={!canSubmit}>
                <Check className="h-4 w-4 mr-1.5" /> Submit for review
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-semibold">{title}</div>
        {hint && <div className="text-xs text-fg-muted mt-0.5">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="block mb-1.5">{label}</Label>
      {children}
    </div>
  );
}

function FileDrop({
  icon,
  label,
  filename,
  accept,
  onFile,
}: {
  icon: React.ReactNode;
  label: string;
  filename: string | null;
  accept: string;
  onFile: (f: File | null) => void;
}) {
  return (
    <label className="block">
      <div className="flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-bg-elevated p-4 text-center hover:border-fg-subtle transition cursor-pointer">
        <div className="text-fg-muted">{icon}</div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-fg-muted">{filename ?? 'Click to select'}</div>
      </div>
      <input
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}