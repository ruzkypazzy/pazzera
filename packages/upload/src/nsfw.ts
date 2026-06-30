/**
 * NSFW / explicit content check (stub).
 *
 * For the hackathon, we return 'safe' for all uploads. Phase 7 will
 * integrate a real model (e.g. an ONNX NSFW classifier running as a
 * sidecar, or a hosted API like Hive / AWS Rekognition).
 *
 * The stub still emits a structured result so the pipeline can
 * evolve without touching callers.
 */
export interface NsfwResult {
  decision: 'safe' | 'flagged' | 'rejected';
  confidence: number; // 0..1
  categories?: { porn: number; hentai: number; sexy: number; neutral: number };
  reason?: string;
}

export async function checkNsfw(_sourcePath: string): Promise<NsfwResult> {
  // TODO Phase 7: real model.
  return { decision: 'safe', confidence: 1.0 };
}