/**
 * Upload pipeline orchestrator.
 *
 * The full state machine for a single song upload:
 *
 *   draft
 *     │
 *     │  finalize() — audio + cover uploaded, recipients submitted
 *     ▼
 *   uploading
 *     │
 *     ▼
 *   processing
 *     │  audio worker extracts metadata + fingerprints
 *     ▼
 *   metadata_extracted
 *     │  waveform worker generates peaks JSON
 *     │  cover worker generates variants
 *     │  preview worker generates 30s clip
 *     ▼
 *   waveform_generated
 *     │
 *     ▼
 *   curator_queued
 *     │  curator agent reviews
 *     ▼
 *   approved  ───────►  published   (isPublic=true, in catalog)
 *   rejected
 *   failed_processing   (terminal; user can retry)
 *
 * Each step is a BullMQ job. The orchestrator owns the song row
 * transitions + storage key wiring.
 */
import { prisma } from '@pazzera/db';
import { enqueue } from '@pazzera/queue';
import { getStorageService, makeAudioKey, makePreviewKey, makeWaveformKey, makeCoverKey, makeCoverVariantKey } from '@pazzera/storage';
import { logger } from '@pazzera/core';
import { readFile, unlink } from 'node:fs/promises';
import { mkdtemp, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { extractAudioMetadata, sha256Hex } from './metadata';
import { fingerprintFile } from './fingerprint';
import { generateWaveformPeaks } from './waveform';
import { generatePreview, readAndCleanupPreview } from './preview';
import { processCover, getImageDimensions, readCoverBuffers } from './cover';
import { checkNsfw } from './nsfw';

export const SONG_STATUS = [
  'draft',
  'uploading',
  'processing',
  'metadata_extracted',
  'waveform_generated',
  'curator_queued',
  'approved',
  'published',
  'rejected',
  'failed_processing',
] as const;

export type SongStatus = (typeof SONG_STATUS)[number];

/** Allowed state transitions for the upload state machine. */
const TRANSITIONS: Record<SongStatus, SongStatus[]> = {
  draft: ['uploading', 'failed_processing'],
  uploading: ['processing', 'failed_processing'],
  processing: ['metadata_extracted', 'failed_processing'],
  metadata_extracted: ['waveform_generated', 'failed_processing'],
  waveform_generated: ['curator_queued', 'failed_processing'],
  curator_queued: ['approved', 'rejected', 'failed_processing'],
  approved: ['published'],
  rejected: ['draft'], // allow re-upload
  published: [], // terminal
  failed_processing: ['processing', 'draft'], // retry
};

export function canTransition(from: SongStatus, to: SongStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

async function transition(songId: string, to: SongStatus, patch?: Record<string, unknown>) {
  const cur = await prisma.song.findUnique({ where: { id: songId }, select: { status: true } });
  if (!cur) throw new Error('Song not found');
  if (!canTransition(cur.status as SongStatus, to)) {
    throw new Error(`Invalid transition ${cur.status} → ${to}`);
  }
  await prisma.song.update({
    where: { id: songId },
    data: { status: to, ...(patch ?? {}) },
  });
}

async function markFailed(songId: string, step: string, err: unknown) {
  logger.error({ songId, step, err }, 'upload:pipeline_failed');
  await prisma.song.update({
    where: { id: songId },
    data: {
      status: 'failed_processing',
      errorStep: step,
      errorMessage: err instanceof Error ? err.message : String(err),
      errorRetries: { increment: 1 },
    },
  });
}

/**
 * The finalize step. Called when the client has uploaded the audio
 * and cover to storage and the metadata is ready for review.
 *
 * Validates recipients + price + duration constraints, downloads the
 * audio to a temp file (so workers can re-process it), then enqueues
 * the processing pipeline.
 */
export async function startProcessing(songId: string): Promise<void> {
  const song = await prisma.song.findUnique({
    where: { id: songId },
    include: { recipients: true },
  });
  if (!song) throw new Error('Song not found');
  if (song.status !== 'uploading' && song.status !== 'draft') {
    throw new Error(`Cannot start processing from status ${song.status}`);
  }

  // Duration constraint (default 30s..20min)
  // (validated after metadata extraction; the 30s minimum is enforced there)

  // Recipients must total 10000 bps
  const totalBps = song.recipients.reduce((s, r) => s + r.splitPercentageBps, 0);
  if (totalBps !== 10000) {
    await prisma.song.update({
      where: { id: songId },
      data: {
        status: 'failed_processing',
        errorStep: 'finalize',
        errorMessage: `Royalty splits must total 10000 bps, got ${totalBps}`,
      },
    });
    throw new Error('Invalid recipient splits');
  }

  await transition(songId, 'processing');
  await enqueue.uploadProcessAudio({
    uploadId: songId,
    songId,
    sourceKey: song.audioKey,
    steps: ['metadata', 'waveform', 'preview', 'cover', 'nsfw', 'curator'],
  });
  logger.info({ songId }, 'upload:processing_started');
}

// ─── STEPS ──────────────────────────────────────────────────────────

/**
 * Download a storage key to a local temp file.
 * For local provider the key IS the local path; for R2 we fetch via
 * the public URL.
 */
async function downloadToTemp(storageKey: string, suffix = '.bin'): Promise<string> {
  const env = (() => {
    try {
      // Use the same env the storage service uses
      return (process.env.STORAGE_PROVIDER ?? 'local');
    } catch {
      return 'local';
    }
  })();
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'pazzera-pipeline-'));
  const out = path.join(tmp, `input-${Date.now()}${suffix}`);
  if (env === 'local') {
    // The key is the relative path inside ./tmp/uploads/
    const localPath = path.resolve(process.cwd(), 'tmp', 'uploads', storageKey);
    const { readFile: rf, writeFile: wf } = await import('node:fs/promises');
    await wf(out, await rf(localPath));
  } else {
    const { getStorageService } = await import('@pazzera/storage');
    const url = await getStorageService().getUrl(storageKey, { expiresInSec: 300 });
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Failed to download ${storageKey}: ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    await writeFile(out, buf);
  }
  return out;
}

/**
 * Step 1: audio metadata + fingerprint
 *   - downloads from storage
 *   - ffprobe → duration / bitrate / codec / sample rate / channels / peak
 *   - ffmpeg loudnorm → LUFS integrated + range + true peak
 *   - SHA-256 binary hash
 *   - acoustic fingerprint
 *   - validates duration (30s..20min)
 *   - updates Song row, transitions to 'metadata_extracted'
 */
export async function runAudioStep(songId: string, sourceKey: string): Promise<void> {
  const tmp = await downloadToTemp(sourceKey, '.audio');
  try {
    const meta = await extractAudioMetadata(tmp);
    if (meta.durationSec < 30) {
      throw new Error(`Audio too short: ${meta.durationSec}s (min 30s)`);
    }
    if (meta.durationSec > 60 * 20) {
      throw new Error(`Audio too long: ${meta.durationSec}s (max 20min)`);
    }
    const [binaryHash, ac] = await Promise.all([sha256Hex(tmp), fingerprintFile(tmp)]);

    // Duplicate check on binary hash
    const dup = await prisma.song.findFirst({
      where: { audioHash: binaryHash, NOT: { id: songId } },
      select: { id: true, title: true },
    });
    if (dup) {
      await prisma.song.update({
        where: { id: songId },
        data: {
          status: 'failed_processing',
          errorStep: 'metadata',
          errorMessage: `Duplicate of existing song "${dup.title}" (binary hash match)`,
        },
      });
      throw new Error('duplicate_binary_hash');
    }

    await prisma.song.update({
      where: { id: songId },
      data: {
        durationSeconds: Math.round(meta.durationSec),
        audioBitrateKbps: meta.bitrateKbps,
        audioSampleRateHz: meta.sampleRateHz,
        audioChannels: meta.channels,
        audioPeakDb: meta.peakDb,
        audioCodec: meta.codec,
        audioContainer: meta.containerFormat,
        audioHash: binaryHash,
        acousticHash: ac.hash,
        audioLufsIntegrated: meta.lufsIntegrated,
        audioLufsRange: meta.lufsRange,
        audioTruePeakDb: meta.truePeakDb,
      },
    });
    await transition(songId, 'metadata_extracted');

    // Fan-out to next steps
    await Promise.all([
      enqueue.uploadGenerateWaveform({ uploadId: songId, songId, sourceKey, steps: [] }),
      enqueue.uploadGeneratePreview({ uploadId: songId, songId, sourceKey, steps: [] }),
      enqueue.uploadProcessCover({ uploadId: songId, songId, sourceKey, steps: [] }),
    ]);
  } catch (err) {
    await markFailed(songId, 'metadata', err);
    throw err;
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}

/**
 * Step 2: waveform peaks
 *   - downloads audio again (R2 / local)
 *   - generates 512 peaks
 *   - uploads JSON to storage
 *   - updates Song.waveformPeaks + waveformKey/Url
 *   - when last step completes, transitions to 'curator_queued'
 */
export async function runWaveformStep(songId: string, sourceKey: string): Promise<void> {
  const tmp = await downloadToTemp(sourceKey, '.audio');
  try {
    const peaks = await generateWaveformPeaks(tmp, 512);
    const storage = getStorageService();
    const key = makeWaveformKey(songId);
    const { url } = await storage.put({
      key,
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify(peaks)),
      publicRead: true,
    });
    await prisma.song.update({
      where: { id: songId },
      data: { waveformKey: key, waveformUrl: url, waveformPeaks: peaks as object },
    });
    await maybeAdvanceToCurator(songId);
  } catch (err) {
    await markFailed(songId, 'waveform', err);
    throw err;
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}

/**
 * Step 3: 30s preview
 */
export async function runPreviewStep(songId: string, sourceKey: string): Promise<void> {
  const tmp = await downloadToTemp(sourceKey, '.audio');
  try {
    const preview = await generatePreview({ sourcePath: tmp, durationSec: 30, bitrateKbps: 128, format: 'mp3' });
    const buf = await readAndCleanupPreview(preview);
    const storage = getStorageService();
    const key = makePreviewKey(songId, 'mp3');
    const { url } = await storage.put({
      key,
      contentType: 'audio/mpeg',
      body: buf,
      publicRead: true,
    });
    await prisma.song.update({
      where: { id: songId },
      data: { previewKey: key, previewUrl: url },
    });
    await maybeAdvanceToCurator(songId);
  } catch (err) {
    await markFailed(songId, 'preview', err);
    throw err;
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}

/**
 * Step 4: cover variants
 *   - downloads cover
 *   - validates dimensions
 *   - resizes to thumb (128) and medium (512)
 *   - uploads all three
 *   - updates Song.coverThumbKey/Url, coverMediumKey/Url
 *   - runs NSFW check (stub)
 */
export async function runCoverStep(songId: string): Promise<void> {
  const song = await prisma.song.findUnique({ where: { id: songId }, select: { coverKey: true } });
  if (!song) return;
  const tmp = await downloadToTemp(song.coverKey, '.cover');
  try {
    const dims = await getImageDimensions(tmp);
    const { thumb, medium } = await processCover(tmp, songId, 'image/jpeg');
    const { thumb: thumbBuf, medium: mediumBuf } = await readCoverBuffers({ thumb, medium, original: { mime: 'image/jpeg', width: dims.width, height: dims.height } } as never);
    const storage = getStorageService();
    const [thumbRes, mediumRes] = await Promise.all([
      storage.put({ key: makeCoverVariantKey(songId, 'thumb', 'webp'), contentType: 'image/webp', body: thumbBuf, publicRead: true }),
      storage.put({ key: makeCoverVariantKey(songId, 'medium', 'webp'), contentType: 'image/webp', body: mediumBuf, publicRead: true }),
    ]);
    await prisma.song.update({
      where: { id: songId },
      data: {
        coverWidthPx: dims.width,
        coverHeightPx: dims.height,
        coverIsSquare: dims.width === dims.height,
        coverAspectRatio: dims.width / dims.height,
        coverThumbKey: thumbRes.key,
        coverThumbUrl: thumbRes.url,
        coverMediumKey: mediumRes.key,
        coverMediumUrl: mediumRes.url,
      },
    });

    // NSFW check
    const nsfw = await checkNsfw(tmp);
    if (nsfw.decision === 'rejected') {
      await prisma.song.update({
        where: { id: songId },
        data: {
          status: 'failed_processing',
          errorStep: 'cover',
          errorMessage: `Cover rejected by content filter: ${nsfw.reason ?? 'NSFW content'}`,
        },
      });
      throw new Error('nsfw_cover_rejected');
    }
    await maybeAdvanceToCurator(songId);
  } catch (err) {
    await markFailed(songId, 'cover', err);
    throw err;
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}

/**
 * Check if all artifact steps are done. If so, transition to
 * 'curator_queued' and enqueue the curator job.
 */
async function maybeAdvanceToCurator(songId: string) {
  const s = await prisma.song.findUnique({
    where: { id: songId },
    select: { status: true, waveformKey: true, previewKey: true, coverThumbKey: true, coverMediumKey: true, durationSeconds: true },
  });
  if (!s) return;
  if (s.status === 'metadata_extracted' && s.waveformKey && s.previewKey && s.coverThumbKey && s.coverMediumKey) {
    await transition(songId, 'waveform_generated');
    await enqueue.uploadCurator({ uploadId: songId, songId, sourceKey: '', steps: ['curator'] });
    await transition(songId, 'curator_queued');
  }
}