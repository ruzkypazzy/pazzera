/**
 * Standalone test for the upload-agent's analyze + decide pipeline.
 *
 *   pnpm tsx scripts/test-upload-agent.ts <audioPath> [coverPath]
 *
 * Runs music-metadata's analyzeAudio + OpenAI's captionCover + decideMetadata
 * and prints the JSON result. No auth, no routes, no DB — just the agent
 * core.
 */
import { analyzeAudio } from '../src/upload-agent/analyze';
import { captionCover, decideMetadata } from '../src/upload-agent/decide';
import { llmHealth } from '../src/upload-agent/llm';
import { promises as fs } from 'node:fs';

const audioPath = process.argv[2];
const coverPath = process.argv[3];

if (!audioPath) {
  console.error('Usage: pnpm tsx scripts/test-upload-agent.ts <audioPath> [coverPath]');
  process.exit(1);
}

async function fileToDataUrl(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  const ext = filePath.toLowerCase().split('.').pop() ?? 'jpg';
  const mime =
    ext === 'png' ? 'image/png' :
    ext === 'webp' ? 'image/webp' :
    ext === 'mp3' ? 'audio/mpeg' :
    'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function main() {
  console.log('--- llmHealth ---');
  console.log(JSON.stringify(llmHealth(), null, 2));

  console.log('\n--- analyzeAudio ---');
  const analysis = await analyzeAudio({ filePath: audioPath, originalFilename: audioPath.split('/').pop() });
  console.log(JSON.stringify(analysis, null, 2));

  let caption: string | null = null;
  if (coverPath) {
    console.log('\n--- captionCover ---');
    const dataUrl = await fileToDataUrl(coverPath);
    const r = await captionCover(dataUrl);
    caption = r.caption;
    console.log(JSON.stringify({ ok: r.llm.ok, caption, error: r.llm.ok ? undefined : r.llm.error, reason: r.llm.ok ? undefined : r.llm.reason }, null, 2));
  } else {
    console.log('\n--- (no cover supplied, skipping captionCover) ---');
  }

  console.log('\n--- decideMetadata ---');
  const { decision, llm } = await decideMetadata({
    analysis,
    coverCaption: caption ?? undefined,
    artistHint: { username: 'ruzkypazzy' },
  });
  console.log(JSON.stringify({
    ok: llm.ok,
    decision,
    model: llm.ok ? llm.model : undefined,
    usage: llm.ok ? llm.usage : undefined,
    error: llm.ok ? undefined : (llm as { error: string }).error,
    reason: llm.ok ? undefined : (llm as { reason?: string }).reason,
  }, null, 2));
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});