/**
 * Waveform peak extraction.
 *
 * Decodes the audio file to mono PCM via ffmpeg, then computes
 * `numPeaks` min/max envelope pairs (one pair per bucket of samples).
 * Output is a JSON object with two arrays — `min` and `max` — of
 * normalized values in [0, 1], matching the `audiowaveform` JSON
 * format so existing player code (and BBC audiowaveform.js) can
 * consume it.
 *
 * Default `numPeaks` = 512 (per spec: minimum 512).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface WaveformPeaks {
  version: 2;
  channels: 1;
  sample_rate: number;
  samples_per_pixel: number;
  bits: 8;
  length: number;
  data: number[]; // interleaved [min, max, min, max, ...] normalized 0..255
  /** Convenience normalized arrays in [0, 1]. */
  min: number[];
  max: number[];
}

export async function generateWaveformPeaks(
  filePath: string,
  numPeaks = 512,
): Promise<WaveformPeaks> {
  const SAMPLE_RATE = 8000; // downsample for speed
  const r = await execFileP('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-loglevel', 'error',
    '-i', filePath,
    '-ac', '1',
    '-ar', String(SAMPLE_RATE),
    '-f', 's16le',
    '-acodec', 'pcm_s16le',
    '-',
  ], { maxBuffer: 64 * 1024 * 1024 });
  const pcm = Buffer.from(r.stdout);
  const totalSamples = pcm.length / 2;
  const samplesPerBucket = Math.max(1, Math.floor(totalSamples / numPeaks));
  const length = Math.ceil(totalSamples / samplesPerBucket);
  const minArr: number[] = new Array(length).fill(0);
  const maxArr: number[] = new Array(length).fill(0);

  for (let i = 0; i < length; i++) {
    const start = i * samplesPerBucket;
    const end = Math.min(start + samplesPerBucket, totalSamples);
    let lo = 32767;
    let hi = -32768;
    for (let j = start; j < end; j++) {
      const s = pcm.readInt16LE(j * 2);
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
    if (lo === 32767) lo = 0;
    if (hi === -32768) hi = 0;
    minArr[i] = lo;
    maxArr[i] = hi;
  }

  // Normalize so the loudest peak hits 1.0
  const absMax = Math.max(...maxArr.map((v) => Math.abs(v)), 1);
  const normMin = minArr.map((v) => Math.max(0, v / absMax));
  const normMax = maxArr.map((v) => Math.max(0, v / absMax));

  // Interleaved 0..255 quantized data (audiowaveform-compatible)
  const data: number[] = [];
  for (let i = 0; i < length; i++) {
    data.push(Math.round((normMin[i] ?? 0) * 255));
    data.push(Math.round((normMax[i] ?? 0) * 255));
  }

  return {
    version: 2,
    channels: 1,
    sample_rate: SAMPLE_RATE,
    samples_per_pixel: samplesPerBucket,
    bits: 8,
    length,
    data,
    min: normMin,
    max: normMax,
  };
}