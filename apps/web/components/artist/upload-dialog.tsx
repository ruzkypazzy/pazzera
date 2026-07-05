'use client';
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Music, Image as ImageIcon, Check, Plus, X, Info, Upload, Loader2, AlertCircle, RefreshCw, Sparkles, CheckCircle2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/cn';
import { AgentChat } from '@/components/agent/AgentChat';
import { Pencil } from 'lucide-react';

interface Recipient {
  username: string;
  role: 'primary_artist' | 'featured_artist' | 'producer' | 'songwriter' | 'label' | 'custom';
  percentageBps: number;
  type: 'internal' | 'external';
  externalWalletAddress?: string;
  externalLabel?: string;
}

const ROLE_LABELS: Record<Recipient['role'], string> = {
  primary_artist: 'Primary artist',
  featured_artist: 'Featured',
  producer: 'Producer',
  songwriter: 'Songwriter',
  label: 'Label',
  custom: 'Custom',
};

const PIPELINE_STEPS = [
  { key: 'draft', label: 'Draft' },
  { key: 'uploading', label: 'Uploading' },
  { key: 'processing', label: 'Processing audio' },
  { key: 'metadata_extracted', label: 'Extracting metadata' },
  { key: 'waveform_generated', label: 'Generating waveform' },
  { key: 'curator_queued', label: 'Curator review' },
  { key: 'published', label: 'Published' },
] as const;

const STEP_PROGRESS: Record<string, number> = {
  draft: 0,
  uploading: 20,
  processing: 35,
  metadata_extracted: 55,
  waveform_generated: 75,
  curator_queued: 88,
  approved: 95,
  published: 100,
  rejected: 100,
  failed_processing: 100,
};

export function UploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (b: boolean) => void }) {
  const [mode, setMode] = useState<'agent' | 'manual'>('agent');
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('0.003');
  const [recipients, setRecipients] = useState<Recipient[]>([
    { username: '', role: 'primary_artist', percentageBps: 7000, type: 'internal' },
    { username: '', role: 'featured_artist', percentageBps: 2000, type: 'internal' },
    { username: '', role: 'producer', percentageBps: 1000, type: 'internal' },
  ]);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);

  // Real upload state
  const [songId, setSongId] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalBps = recipients.reduce((s, r) => s + r.percentageBps, 0);
  const validSplit = totalBps === 10000;
  const priceValid = Number(price) >= 0.001 && Number(price) <= 0.005;
  const canAdvance = step === 1 ? title.length >= 3 : step === 2 ? recipients.every((r) => r.username.length >= 1) && validSplit : true;

  // Polling for processing status
  useEffect(() => {
    if (!songId || !processing) return;
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/upload/status/${songId}`);
        const data = await r.json();
        if (data?.song) {
          setUploadStatus(data.song.status);
          setUploadProgress(STEP_PROGRESS[data.song.status] ?? 0);
          if (data.song.status === 'published' || data.song.status === 'rejected' || data.song.status === 'failed_processing') {
            setProcessing(false);
            if (pollRef.current) clearInterval(pollRef.current);
          }
        }
      } catch {
        // ignore
      }
    }, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [songId, processing]);

  function updateRecipient(i: number, patch: Partial<Recipient>) {
    setRecipients((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeRecipient(i: number) {
    setRecipients((prev) => prev.filter((_, idx) => idx !== i));
  }
  function addRecipient() {
    setRecipients((prev) => [...prev, { username: '', role: 'custom', percentageBps: 0, type: 'internal' }]);
  }

  async function uploadWithProgress(url: string, file: File, headers: Record<string, string>): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url, true);
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 100));
        }
      });
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
      });
      xhr.addEventListener('error', () => reject(new Error('Upload network error')));
      xhr.send(file);
    });
  }

  async function startUploadPipeline() {
    if (!audioFile || !coverFile) {
      setError('Please select both audio and cover files');
      return;
    }
    setError(null);
    setProcessing(true);
    setUploadStatus('creating-draft');
    setUploadProgress(5);
    try {
      // 1. Create draft
      const draftRes = await fetch('/api/songs/create-draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': getCookie('csrf') ?? '' },
        body: JSON.stringify({ title, description, genre: 'house', language: 'en' }),
      });
      const draft = await draftRes.json();
      if (!draftRes.ok) throw new Error(draft?.error?.message ?? 'Could not create draft');
      const id = draft.songId as string;
      setSongId(id);

      // 2. Get audio upload ticket
      setUploadStatus('uploading');
      const audioTicketRes = await fetch('/api/upload/audio', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': getCookie('csrf') ?? '' },
        body: JSON.stringify({ songId: id, filename: audioFile.name, mime: audioFile.type, size: audioFile.size }),
      });
      const audioTicket = await audioTicketRes.json();
      if (!audioTicketRes.ok) throw new Error(audioTicket?.error?.message ?? 'Audio ticket failed');

      // 3. Upload audio to presigned URL
      await uploadWithProgress(audioTicket.url, audioFile, { 'content-type': audioFile.type });
      setUploadProgress(40);

      // 4. Get cover upload ticket
      const coverTicketRes = await fetch('/api/upload/cover', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': getCookie('csrf') ?? '' },
        body: JSON.stringify({ songId: id, filename: coverFile.name, mime: coverFile.type, size: coverFile.size }),
      });
      const coverTicket = await coverTicketRes.json();
      if (!coverTicketRes.ok) throw new Error(coverTicket?.error?.message ?? 'Cover ticket failed');

      // 5. Upload cover
      await uploadWithProgress(coverTicket.url, coverFile, { 'content-type': coverFile.type });
      setUploadProgress(60);

      // 6. Finalize (recipients + price)
      const finRes = await fetch('/api/upload/finalize', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': getCookie('csrf') ?? '' },
        body: JSON.stringify({ songId: id, priceUsdc: price, recipients }),
      });
      const fin = await finRes.json();
      if (!finRes.ok) throw new Error(fin?.error?.message ?? 'Finalize failed');
      setUploadStatus('processing');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setUploadStatus('failed_processing');
      setProcessing(false);
    }
  }

  const isFinished = uploadStatus === 'published' || uploadStatus === 'rejected' || uploadStatus === 'failed_processing';
  const currentStepIndex = PIPELINE_STEPS.findIndex((s) => s.key === uploadStatus);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload music</DialogTitle>
          <DialogDescription>
            Audio + cover → processing pipeline → Curator review → published.
          </DialogDescription>
        </DialogHeader>

        {/* AI Agent only — the manual form was removed because the
            dedicated /upload page is now a chatbot-first surface and
            we don't want two competing upload paths. */}

        {/* AI Agent only — the manual form was removed because the
            dedicated /upload page is now a chatbot-first surface and
            we don't want two competing upload paths. */}
        {!songId && (
          <AgentChat
            onCommitSuccess={(songId) => {
              // Don't auto-close — user may want to keep chatting with
              // the agent or hit Reset to start a new track. They can
              // press the X or click outside to close when ready.
              void songId;
            }}
          />
        )}

        {/* After upload starts: real-time pipeline progress */}
        {songId && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-bg-elevated p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">{title}</div>
                <Badge variant={isFinished ? (uploadStatus === 'published' ? 'success' : uploadStatus === 'rejected' ? 'danger' : 'warning') : 'accent'}>
                  {uploadStatus.replace(/_/g, ' ')}
                </Badge>
              </div>
              <Progress value={uploadProgress} />
              <div className="space-y-2 text-sm">
                <AnimatePresence>
                  {PIPELINE_STEPS.map((s, i) => {
                    const state =
                      i < currentStepIndex
                        ? 'done'
                        : i === currentStepIndex
                          ? isFinished
                            ? uploadStatus === 'published' ? 'done' : uploadStatus === 'rejected' ? 'rejected' : 'failed'
                            : 'active'
                          : 'pending';
                    return (
                      <motion.div
                        key={s.key}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className="flex items-center gap-2"
                      >
                        {state === 'done' ? (
                          <CheckCircle2 className="h-4 w-4 text-accent" />
                        ) : state === 'active' ? (
                          <Loader2 className="h-4 w-4 text-accent animate-spin" />
                        ) : state === 'rejected' ? (
                          <X className="h-4 w-4 text-danger" />
                        ) : state === 'failed' ? (
                          <AlertCircle className="h-4 w-4 text-warning" />
                        ) : (
                          <div className="h-4 w-4 rounded-full border border-border" />
                        )}
                        <span className={cn(state === 'pending' && 'text-fg-muted')}>{s.label}</span>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </div>
            {error && (
              <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
                {error}
              </div>
            )}
            {uploadStatus === 'published' && (
              <div className="rounded-2xl border border-accent/30 bg-accent/5 p-4 text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent" />
                <span>Your track is live in the Pazzera catalog.</span>
              </div>
            )}
            {uploadStatus === 'rejected' && (
              <div className="rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm">
                Curator rejected this track. You can update details and re-submit.
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              {uploadStatus === 'failed_processing' && (
                <Button variant="secondary" onClick={startUploadPipeline}>
                  <RefreshCw className="h-4 w-4 mr-2" /> Retry
                </Button>
              )}
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
            </div>
          </div>
        )}
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
function FileDrop({ icon, label, filename, accept, onFile }: { icon: React.ReactNode; label: string; filename: string | null; accept: string; onFile: (f: File | null) => void }) {
  return (
    <label className="block">
      <div className="flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-bg-elevated p-4 text-center hover:border-fg-subtle transition cursor-pointer">
        <div className="text-fg-muted">{icon}</div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-fg-muted">{filename ?? 'Click to select'}</div>
      </div>
      <input type="file" accept={accept} className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </label>
  );
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name}=`));
  return m?.split('=')[1] ?? null;
}