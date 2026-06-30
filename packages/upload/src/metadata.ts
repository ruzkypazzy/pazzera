/**
 * Audio metadata extraction via ffprobe + loudness analysis via ffmpeg's
 * EBU R128 loudnorm filter.
 *
 * The system expects `ffmpeg` and `ffprobe` on PATH (installed in the
 * Docker image via `apk add ffmpeg`).
 *
 * Returns:
 *   - duration (seconds, float)
 *   - bitrate (kbps, int)
 *   - codec (string)
 *   - sampleRate (Hz, int)
 *   - channels (int)
 *   - peakDb (float, max sample peak; -inf if unknown)
 *   - lufsIntegrated (float; -70 if silence)
 *   - lufsRange (float; LU range)
 *   - truePeakDb (float)
 *
 * Throws `MetadataError` on any failure — caller decides whether to
 * reject the upload or mark for retry.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';

const execFileP = promisify(execFile);

export class MetadataError extends Error {
  constructor(message: string, public meta?: Record<string, unknown>) {
    super(message);
    this.name = 'MetadataError';
  }
}

export interface AudioMetadata {
  durationSec: number;
  bitrateKbps: number;
  codec: string;
  sampleRateHz: number;
  channels: number;
  peakDb: number;
  lufsIntegrated: number;
  lufsRange: number;
  truePeakDb: number;
  containerFormat: string;
  /** Optional silence ratio 0..1. */
  silenceRatio?: number;
}

interface FfprobeStream {
  codec_name?: string;
  codec_type?: string;
  sample_rate?: string;
  channels?: number;
  bit_rate?: string;
  duration?: string;
}
interface FfprobeFormat {
  duration?: string;
  bit_rate?: string;
  format_name?: string;
}
interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

export async function extractAudioMetadata(filePathOrUrl: string): Promise<AudioMetadata> {
  let stdout: string;
  try {
    const r = await execFileP('ffprobe', [
      '-v', 'error',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      filePathOrUrl,
    ], { maxBuffer: 32 * 1024 * 1024 });
    stdout = r.stdout;
  } catch (err) {
    throw new MetadataError('ffprobe failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  let parsed: FfprobeOutput;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    throw new MetadataError('ffprobe returned invalid JSON', {
      stdout: stdout.slice(0, 500),
      err: err instanceof Error ? err.message : String(err),
    });
  }

  const audio = parsed.streams?.find((s) => s.codec_type === 'audio');
  if (!audio) {
    throw new MetadataError('No audio stream found in file');
  }
  const fmt = parsed.format ?? {};

  const duration = Number(audio.duration ?? fmt.duration ?? 0);
  const bitrate = Number(audio.bit_rate ?? fmt.bit_rate ?? 0);
  const sampleRate = Number(audio.sample_rate ?? 48000);
  const channels = Number(audio.channels ?? 2);

  // Peak detection: use ffmpeg's volumedetect
  let peakDb = -Infinity;
  try {
    const r = await execFileP('ffmpeg', [
      '-hide_banner',
      '-nostats',
      '-i', filePathOrUrl,
      '-af', 'volumedetect',
      '-f', 'null',
      '-',
    ], { maxBuffer: 8 * 1024 * 1024 });
    const stderr = r.stderr.toString();
    const m = /max_volume:\s*([-\d.]+)\s*dB/.exec(stderr);
    if (m && m[1]) {
      peakDb = Number(m[1]);
      if (Number.isNaN(peakDb)) peakDb = -Infinity;
    }
  } catch (err) {
    // Not fatal — peakDb stays -Infinity; loudnorm pass will fill in.
  }

  // EBU R128 loudness analysis
  let lufsIntegrated = -70;
  let lufsRange = 0;
  let truePeakDb = peakDb === -Infinity ? -70 : peakDb;
  try {
    const r = await execFileP('ffmpeg', [
      '-hide_banner',
      '-nostats',
      '-i', filePathOrUrl,
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json',
      '-f', 'null',
      '-',
    ], { maxBuffer: 8 * 1024 * 1024 });
    const stderr = r.stderr.toString();
    // JSON appears at the end of stderr
    const idx = stderr.lastIndexOf('{');
    if (idx >= 0) {
      const json = stderr.slice(idx).trim();
      try {
        const stats = JSON.parse(json) as {
          input_i?: string;
          input_tp?: string;
          input_lra?: string;
        };
        if (stats.input_i) lufsIntegrated = Number(stats.input_i);
        if (stats.input_lra) lufsRange = Number(stats.input_lra);
        if (stats.input_tp) truePeakDb = Number(stats.input_tp);
      } catch {
        // ignore JSON parse — leave defaults
      }
    }
  } catch {
    // loudnorm failed — leave defaults
  }

  return {
    durationSec: Math.round(duration * 100) / 100,
    bitrateKbps: Math.round(bitrate / 1000),
    codec: audio.codec_name ?? 'unknown',
    sampleRateHz: sampleRate,
    channels,
    peakDb: peakDb === -Infinity ? -70 : peakDb,
    lufsIntegrated,
    lufsRange,
    truePeakDb,
    containerFormat: fmt.format_name ?? 'unknown',
  };
}

/**
 * Compute a SHA-256 of the raw file bytes. Used for binary-hash-based
 * duplicate detection (exact re-uploads).
 */
export async function sha256Hex(input: string | Buffer): Promise<string> {
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256');
  if (typeof input === 'string') {
    // Treat as file path
    const buf = await readFile(input);
    hash.update(buf);
  } else {
    hash.update(input);
  }
  return hash.digest('hex');
}