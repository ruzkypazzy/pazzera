/**
 * Demo mode seeder.
 *
 * Runs after the main seed to enrich existing songs with:
 *   - synthetic waveform peaks JSON
 *   - cover dimension metadata
 *   - empty preview URLs (real preview requires ffmpeg + uploaded audio)
 *
 * Idempotent — safe to re-run.
 */
import { PrismaClient } from '@prisma/client';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { STORAGE_PREFIXES } from '@pazzera/storage';

const prisma = new PrismaClient();

function generateDemoPeaks(numPeaks = 512): { min: number[]; max: number[]; length: number; data: number[] } {
  const min: number[] = [];
  const max: number[] = [];
  const data: number[] = [];
  for (let i = 0; i < numPeaks; i++) {
    const t = i / numPeaks;
    // Slightly musical envelope + small noise
    const env = 0.4 + 0.3 * Math.sin(t * Math.PI * 4) + 0.1 * Math.sin(t * Math.PI * 18);
    const noise = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const v = Math.max(0, Math.min(1, env + noise * 0.1));
    min.push(v * 0.7);
    max.push(v);
    data.push(Math.round(min[i]! * 255));
    data.push(Math.round(max[i]! * 255));
  }
  return { min, max, length: numPeaks, data };
}

async function main() {
  console.log('demo:seed:start');
  const songs = await prisma.song.findMany({
    where: { isPublic: true, status: 'published' },
    take: 5,
  });
  for (const song of songs) {
    const peaks = generateDemoPeaks(512);
    // Write the peaks JSON to local storage so the player can load it
    const localPath = path.join(
      process.cwd(),
      'tmp',
      'uploads',
      STORAGE_PREFIXES.waveform,
      song.id,
      'peaks.json',
    );
    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, JSON.stringify(peaks));
    await prisma.song.update({
      where: { id: song.id },
      data: {
        waveformPeaks: peaks as object,
        waveformKey: `${STORAGE_PREFIXES.waveform}/${song.id}/peaks.json`,
        waveformUrl: `/uploads/${STORAGE_PREFIXES.waveform}/${song.id}/peaks.json`,
        coverWidthPx: 600,
        coverHeightPx: 600,
        coverIsSquare: true,
        coverAspectRatio: 1.0,
        coverThumbKey: `songs/covers/thumbs/${song.id}/thumb.webp`,
        coverMediumKey: `songs/covers/medium/${song.id}/medium.webp`,
        coverThumbUrl: song.coverUrl,
        coverMediumUrl: song.coverUrl,
        audioBitrateKbps: song.audioBitrateKbps ?? 256,
        audioSampleRateHz: song.audioSampleRateHz ?? 44100,
        audioChannels: song.audioChannels ?? 2,
        audioPeakDb: song.audioPeakDb ?? -3,
        audioLufsIntegrated: song.audioLufsIntegrated ?? -16,
        audioLufsRange: song.audioLufsRange ?? 8,
        audioTruePeakDb: song.audioTruePeakDb ?? -1.5,
      },
    });
    console.log('demo:seed:enriched', song.slug);
  }
  console.log('demo:seed:done', { count: songs.length });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('demo:seed:fail', err);
    await prisma.$disconnect();
    process.exit(1);
  });