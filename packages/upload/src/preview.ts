/**
 * Preview clip generation.
 *
 *   - Cuts the first 30 seconds of the source audio
 *   - Encodes as MP3 (CBR 128 kbps) — universal browser support
 *   - Falls back to AAC if MP3 encoder is missing
 *
 * Returns the absolute path of the generated file (caller uploads it
 * to storage and writes the resulting key/url to the DB).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execFileP = promisify(execFile);

export interface PreviewOptions {
  /** Source audio file path or storage key URL. */
  sourcePath: string;
  /** Preview length in seconds. Default 30. */
  durationSec?: number;
  /** Target bitrate. Default 128 kbps. */
  bitrateKbps?: number;
  /** Output container. Default mp3. */
  format?: 'mp3' | 'aac';
}

export interface PreviewResult {
  /** Absolute path of the generated preview file. */
  filePath: string;
  /** Container used. */
  format: 'mp3' | 'aac';
  /** Bitrate. */
  bitrateKbps: number;
  /** Duration of the generated clip in seconds. */
  durationSec: number;
}

export async function generatePreview(opts: PreviewOptions): Promise<PreviewResult> {
  const duration = opts.durationSec ?? 30;
  const bitrate = opts.bitrateKbps ?? 128;
  const format = opts.format ?? 'mp3';
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'pazzera-preview-'));
  const out = path.join(tmpDir, `preview.${format}`);
  try {
    await execFileP('ffmpeg', [
      '-hide_banner',
      '-nostats',
      '-loglevel', 'error',
      '-i', opts.sourcePath,
      '-t', String(duration),
      '-vn',
      '-ac', '2',
      '-ar', '44100',
      '-b:a', `${bitrate}k`,
      '-y', out,
    ], { maxBuffer: 16 * 1024 * 1024 });
  } catch (err) {
    await unlink(out).catch(() => undefined);
    throw new Error(`ffmpeg preview generation failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { filePath: out, format, bitrateKbps: bitrate, durationSec: duration };
}

/**
 * Read a generated preview file back as a buffer for upload to storage.
 * Cleans up the temp file.
 */
export async function readAndCleanupPreview(result: PreviewResult): Promise<Buffer> {
  const { readFile } = await import('node:fs/promises');
  const buf = await readFile(result.filePath);
  await unlink(result.filePath).catch(() => undefined);
  return buf;
}