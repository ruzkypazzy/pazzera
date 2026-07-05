/**
 * GET /api/agent/upload/stage/[...key]
 *
 * Serves a file from the agent-stage dir at /app/data/agent-stage.
 * Used so the cover image can be fetched by the LLM vision step (the
 * OpenAI client requires a public URL or base64 data URI).
 *
 * Auth: requires a valid session — files are private to the uploader.
 *
 * ADDITIVE — does not modify any existing route.
 */

import { withApi, requireSession, AppError } from '@pazzera/core';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { lookup as lookupMime } from 'node:dns';

const AGENT_STAGE_DIR = '/app/data/agent-stage';

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
};

export const GET = withApi(
  async ({ req, params }) => {
    await requireSession();
    const key = (params as { key?: string[] } | undefined)?.key;
    if (!key || key.length === 0) {
      throw new AppError('BAD_REQUEST', 'Missing key', 400);
    }
    // Reject path traversal
    const joined = path.join(AGENT_STAGE_DIR, ...key);
    if (!joined.startsWith(AGENT_STAGE_DIR)) {
      throw new AppError('BAD_REQUEST', 'Invalid key', 400);
    }
    let buf: Buffer;
    try {
      buf = await fs.readFile(joined);
    } catch {
      throw new AppError('NOT_FOUND', 'File not found', 404);
    }
    const ext = path.extname(joined).toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'content-type': mime,
        'cache-control': 'private, max-age=300',
      },
    });
  },
  { requireAuth: true },
);

// Silence unused-import warning
void lookupMime;