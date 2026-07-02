/**
 * Cover art processing.
 *
 *   - Validate dimensions (min 500×500, recommended 1:1)
 *   - Generate three variants:
 *     - thumb  (128×128 webp)
 *     - medium (512×512 webp)
 *     - original (passed through)
 *
 * Output is uploaded to storage under songs/covers/{songId}/{variant}.webp
 * with the original stored separately for archival.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execFileP = promisify(execFile);

export interface CoverDimensions {
  width: number;
  height: number;
}

export interface CoverVariants {
  thumb: { path: string; mime: 'image/webp'; width: number; height: number };
  medium: { path: string; mime: 'image/webp'; width: number; height: number };
  original: { mime: string; width: number; height: number };
}

export interface CoverProcessResult extends CoverVariants {
  isSquare: boolean;
  aspectRatio: number;
}

export async function getImageDimensions(filePath: string): Promise<CoverDimensions> {
  try {
    const r = await execFileP('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=s=x:p=0',
      filePath,
    ]);
    const line = r.stdout.trim().split('\n').pop() ?? '';
    const [w, h] = line.split('x').map((n) => Number(n));
    if (!w || !h) throw new Error('Could not parse dimensions');
    return { width: w, height: h };
  } catch (err) {
    throw new Error(`Could not read image dimensions: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function validateCoverDims(dims: CoverDimensions): { ok: boolean; reason?: string } {
  if (dims.width < 500 || dims.height < 500) {
    return { ok: false, reason: `Cover too small: ${dims.width}×${dims.height}. Minimum 500×500.` };
  }
  return { ok: true };
}

export async function processCover(
  sourcePath: string,
  songId: string,
  originalMime: string,
): Promise<CoverProcessResult> {
  const dims = await getImageDimensions(sourcePath);
  const v = validateCoverDims(dims);
  if (!v.ok) throw new Error(v.reason ?? 'Invalid cover');
  const isSquare = dims.width === dims.height;
  const aspectRatio = dims.width / dims.height;
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), `pazzera-cover-${songId}-`));
  const thumbPath = path.join(tmpDir, 'thumb.webp');
  const mediumPath = path.join(tmpDir, 'medium.webp');

  await Promise.all([
    resize(sourcePath, thumbPath, 128, 128),
    resize(sourcePath, mediumPath, 512, 512),
  ]);

  return {
    isSquare,
    aspectRatio,
    thumb: { path: thumbPath, mime: 'image/webp', width: 128, height: 128 },
    medium: { path: mediumPath, mime: 'image/webp', width: 512, height: 512 },
    original: { mime: originalMime, width: dims.width, height: dims.height },
  };
}

async function resize(input: string, output: string, w: number, h: number): Promise<void> {
  try {
    // ffmpeg 5+ removed the value for `force_original_aspect_ratio`.
    // The bare flag is equivalent to `=decrease`. To crop instead of
    // fit, we explicitly chain a `crop` after the scale.
    await execFileP('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', input,
      '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`,
      '-quality', '85',
      '-y', output,
    ], { maxBuffer: 16 * 1024 * 1024 });
  } catch (err) {
    throw new Error(`Cover resize failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Read all generated variants into buffers for upload. */
export async function readCoverBuffers(r: CoverProcessResult): Promise<{
  thumb: Buffer;
  medium: Buffer;
}> {
  const [thumb, medium] = await Promise.all([readFile(r.thumb.path), readFile(r.medium.path)]);
  // Best-effort cleanup
  await Promise.all([
    unlink(r.thumb.path).catch(() => undefined),
    unlink(r.medium.path).catch(() => undefined),
  ]);
  return { thumb, medium };
}