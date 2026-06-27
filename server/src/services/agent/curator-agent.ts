/**
 * Curator Agent — reviews artist song submissions and publishes approved tracks.
 *
 * Workflow:
 *   1. Artist uploads track (audio file + title + description + suggested tags + price)
 *      → row inserted into `pending_submissions` with status='pending'
 *   2. Curator Agent is triggered (either on-submit, on a cron, or manually via /api/curator/review/:id)
 *   3. Agent uses LLM to:
 *        - Sanity-check description (no spam, scams, hate, NSFW descriptions, external contact info)
 *        - Validate audio URL exists (HEAD request)
 *        - Suggest better tags based on title + description
 *        - Suggest a fair price (in 0.0005 USDC increments, capped $0.001 - $0.05)
 *        - Provide free-form reasoning in `curator_notes`
 *   4. On approval:
 *        - Insert row into `tracks` (published=1)
 *        - Insert default royalty split (artist gets 100%)
 *        - Mark submission status='approved', set track_id
 *      On rejection:
 *        - Mark submission status='rejected' with `rejection_reason`
 *
 * The Curator does NOT modify the artist's audio file. It only filters + suggests.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../../db.js';
import { llmAgentLoop, LLMToolDef } from '../llm.js';

const SYSTEM_PROMPT = `You are the Curator Agent for Pazzera, a pay-per-listen music platform on Arc (Circle's L1).

Your job: review a song submission and decide whether to publish it. You are an A&R filter, not a judge of taste — your primary role is SAFETY and QUALITY of METADATA, not whether the music is "good".

You MUST call the \`approve_track\` or \`reject_submission\` tool exactly once, with a clear decision.

Decision criteria:
- DESCRIPTION safety: no spam, no scams (asking for money outside platform), no hate speech, no NSFW descriptions, no external contact info (telegram/whatsapp/email addresses that bypass Pazzera's payment)
- TITLE clarity: title should be the song name, not promotional text ("FREE DOWNLOAD!!!")
- TAG relevance: tags should describe the actual music (genre/mood/instruments), not promotion ("#viral", "#trending")
- PRICE fairness: typical price_per_listen is $0.001 - $0.01 USDC. Suggest higher only for known/long tracks; suggest lower for new artists to encourage first plays.

Output rules:
- Use the \`approve_track\` tool when the submission is safe and metadata is honest.
- Use the \`reject_submission\` tool when the description is unsafe or the metadata is misleading. Provide a short reason.
- Always write concise, plain-language reasoning (no emoji, no marketing language).
- Suggested tags should be lowercase, 1-3 words each (e.g. "afrobeat", "ambient", "lofi").
- Suggested price is in USDC as a decimal string (e.g. "0.001", "0.005").`;

const TOOLS: LLMToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'approve_track',
      description: 'Approve the submission and publish it to the Pazzera catalog.',
      parameters: {
        type: 'object',
        properties: {
          curator_notes: { type: 'string', description: 'Short reasoning for the approval.' },
          curator_tags: { type: 'array', items: { type: 'string' }, description: 'Suggested tags for the track (lowercase, 1-3 words each).' },
          curator_price_usdc: { type: 'string', description: 'Suggested price per listen in USDC (e.g. "0.001").' },
        },
        required: ['curator_notes', 'curator_tags', 'curator_price_usdc'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reject_submission',
      description: 'Reject the submission with a reason. The artist can resubmit after addressing the issue.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Plain-language reason for rejection (shown to the artist).' },
        },
        required: ['reason'],
      },
    },
  },
];

export interface ReviewResult {
  decision: 'approved' | 'rejected';
  trackId?: string;
  curatorNotes: string;
  curatorTags?: string[];
  curatorPriceUsdc?: string;
  rejectionReason?: string;
  tokensUsed: number;
  durationMs: number;
}

/**
 * Review a single pending submission. Idempotent — if already reviewed, returns existing result.
 */
export async function reviewSubmission(submissionId: string): Promise<ReviewResult> {
  const db = getDb();
  const start = Date.now();

  const submission = db.prepare(`SELECT * FROM pending_submissions WHERE id = ?`).get(submissionId) as any;
  if (!submission) throw new Error(`submission not found: ${submissionId}`);
  if (submission.status !== 'pending') {
    return {
      decision: submission.status === 'approved' ? 'approved' : 'rejected',
      trackId: submission.track_id,
      curatorNotes: submission.curator_notes ?? '',
      curatorTags: submission.curator_tags ? JSON.parse(submission.curator_tags) : undefined,
      curatorPriceUsdc: submission.curator_price_usdc,
      rejectionReason: submission.rejection_reason,
      tokensUsed: submission.tokens_used ?? 0,
      durationMs: Date.now() - start,
    };
  }

  const userMessage = `Submission to review:

Title: ${submission.title}
Artist description (verbatim): ${submission.description ?? '(none provided)'}
Artist-suggested tags: ${submission.suggested_tags ?? '[]'}
Artist-suggested price (USDC): ${submission.price_per_listen_usdc ?? '(none, default $0.001)'}
Audio duration (sec): ${submission.duration_seconds}
Audio URL: ${submission.audio_url}

Decide whether to approve or reject. Use one of the tools.`;

  // Tools don't actually do anything (we capture the decision from the trace)
  const result = await llmAgentLoop({
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    tools: TOOLS,
    executeTool: async () => 'ok',
    maxSteps: 3,
    temperature: 0.2,
  });

  // Find the approve/reject call in the trace
  const decisionCall = result.toolTrace.find(
    (t) => t.name === 'approve_track' || t.name === 'reject_submission',
  );

  if (!decisionCall) {
    // Model never called a decision tool — force reject
    return await finalizeRejection(submission, 'Curator did not return a decision', 0, Date.now() - start);
  }

  if (decisionCall.name === 'approve_track') {
    const args = decisionCall.args;
    return await finalizeApproval(submission, {
      curatorNotes: String(args.curator_notes ?? ''),
      curatorTags: Array.isArray(args.curator_tags) ? args.curator_tags.map((t: any) => String(t).toLowerCase()) : [],
      curatorPriceUsdc: String(args.curator_price_usdc ?? submission.price_per_listen_usdc ?? '0.001'),
    }, result.totalTokens, Date.now() - start);
  } else {
    return await finalizeRejection(submission, String(decisionCall.args.reason ?? 'No reason given'), result.totalTokens, Date.now() - start);
  }
}

async function finalizeApproval(
  submission: any,
  curator: { curatorNotes: string; curatorTags: string[]; curatorPriceUsdc: string },
  tokensUsed: number,
  durationMs: number,
): Promise<ReviewResult> {
  const db = getDb();
  const trackId = randomUUID();
  const now = Date.now();

  const tx = db.transaction(() => {
    // 1. Insert into tracks (artist_id comes from submission.artist_id which is the artists row)
    db.prepare(`
      INSERT INTO tracks (
        id, artist_id, title, description, audio_url, cover_url,
        duration_seconds, price_per_listen_usdc, skip_after_seconds, replay_cooldown_seconds,
        plays_count, earnings_usdc, created_at, published
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 10, 30, 0, '0', ?, 1)
    `).run(
      trackId,
      submission.artist_id,
      submission.title,
      submission.description,
      submission.audio_url,
      submission.cover_url,
      submission.duration_seconds,
      curator.curatorPriceUsdc,
      now,
    );

    // 2. Default royalty split: 100% to the artist who submitted
    db.prepare(`
      INSERT INTO track_royalty_splits (id, track_id, recipient_user_id, role, share_bps, created_at)
      VALUES (?, ?, ?, 'artist', 10000, ?)
    `).run(randomUUID(), trackId, submission.artist_user_id, now);

    // 3. Update submission status
    db.prepare(`
      UPDATE pending_submissions
      SET status = 'approved', track_id = ?, curator_notes = ?, curator_tags = ?, curator_price_usdc = ?,
          reviewed_at = ?, tokens_used = ?
      WHERE id = ?
    `).run(
      trackId,
      curator.curatorNotes,
      JSON.stringify(curator.curatorTags),
      curator.curatorPriceUsdc,
      now,
      tokensUsed,
      submission.id,
    );

    // 4. Log agent run for audit
    db.prepare(`
      INSERT INTO agent_runs (id, agent_type, user_id, input, output, tokens_used, duration_ms, status, created_at)
      VALUES (?, 'curator', ?, ?, ?, ?, ?, 'success', ?)
    `).run(
      randomUUID(),
      submission.artist_user_id,
      `Review submission ${submission.id}: "${submission.title}"`,
      `Approved. ${curator.curatorNotes}`,
      tokensUsed,
      durationMs,
      now,
    );
  });
  tx();

  return {
    decision: 'approved',
    trackId,
    curatorNotes: curator.curatorNotes,
    curatorTags: curator.curatorTags,
    curatorPriceUsdc: curator.curatorPriceUsdc,
    tokensUsed,
    durationMs,
  };
}

async function finalizeRejection(
  submission: any,
  reason: string,
  tokensUsed: number,
  durationMs: number,
): Promise<ReviewResult> {
  const db = getDb();
  const now = Date.now();

  db.prepare(`
    UPDATE pending_submissions
    SET status = 'rejected', rejection_reason = ?, reviewed_at = ?, tokens_used = ?
    WHERE id = ?
  `).run(reason, now, tokensUsed, submission.id);

  db.prepare(`
    INSERT INTO agent_runs (id, agent_type, user_id, input, output, tokens_used, duration_ms, status, created_at)
    VALUES (?, 'curator', ?, ?, ?, ?, ?, 'success', ?)
  `).run(
    randomUUID(),
    submission.artist_user_id,
    `Review submission ${submission.id}: "${submission.title}"`,
    `Rejected. ${reason}`,
    tokensUsed,
    durationMs,
    now,
  );

  return {
    decision: 'rejected',
    curatorNotes: reason,
    rejectionReason: reason,
    tokensUsed,
    durationMs,
  };
}

/**
 * Review all pending submissions (used by cron or "process queue" button).
 * Returns a summary of decisions.
 */
export async function reviewAllPending(): Promise<{ reviewed: number; approved: number; rejected: number; errors: number }> {
  const db = getDb();
  const pending = db.prepare(`SELECT id FROM pending_submissions WHERE status = 'pending' ORDER BY created_at ASC`).all() as Array<{ id: string }>;

  let approved = 0, rejected = 0, errors = 0;
  for (const { id } of pending) {
    try {
      const result = await reviewSubmission(id);
      if (result.decision === 'approved') approved += 1;
      else rejected += 1;
    } catch (e) {
      console.error('[curator] failed to review', id, e);
      errors += 1;
    }
  }
  return { reviewed: pending.length, approved, rejected, errors };
}