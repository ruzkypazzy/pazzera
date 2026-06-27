/**
 * Royalty Splitter Agent — decides how each per-play USDC payment is
 * distributed across co-artists (artist + producer + featured + songwriter).
 *
 * Triggered: per completed play (NOT batched).
 *
 * The agent uses LLM reasoning to:
 *   1. Read the track's configured royalty split (artist set at submission)
 *   2. Read each recipient's wallet state (active? missing?)
 *   3. Decide how to allocate this play's USDC across recipients
 *   4. Handle edge cases:
 *        - Shares don't sum to 10000 bps → flag but don't fail the play
 *        - Wallet missing for a recipient → flag + default to primary artist
 *        - Conflicting claims → write reasoning, default to existing config
 *
 * The LLM is given tools; the actual financial allocation is recorded by the
 * `record_split` tool call. The agent CANNOT allocate money without calling
 * the tool — the LLM's text response is reasoning, not action.
 *
 * The agent runs on every play. User has opted in to LLM cost per split
 * (~$0.0001 / play on gpt-4o-mini).
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../../db.js';
import { llmAgentLoop, LLMToolDef } from '../llm.js';

const SYSTEM_PROMPT = `You are the Royalty Splitter Agent for Pazzera, a pay-per-listen music platform on Arc.

A track was just played. You must decide how to route the per-play USDC payment across the credited recipients.

Inputs you receive:
- play_id, track_id, charged_usdc (e.g. "0.001")
- The track's configured royalty split (artist + co-artists + their wallet states)
- Recent activity for each wallet (last_active timestamp)

Your job:
1. Use \`lookup_track_splits\` to read the track's configured royalty split.
2. Use \`lookup_wallets\` to check each recipient's wallet state.
3. Use \`record_split\` to commit to a final allocation. The splits you record must sum to charged_usdc exactly (use the charged_usdc amount for the recipient, basis-point math doesn't need to be exact — distribute the actual amount).
4. If you find anything abnormal (missing wallet, shares don't sum to 100%, etc.), use \`flag_for_review\` to add a note.

Decision rules:
- If shares sum to 10000 bps and all wallets exist: split exactly as configured.
- If a recipient has no wallet: skip them, redistribute their share to the primary artist, and flag for review.
- If shares don't sum to 10000 bps: flag for review, but still record a split that pays out the charged_usdc (default: 100% to the primary artist if shares are clearly broken).
- If shares sum to MORE than 10000: cap each at the proportional share, flag for review.
- Always write the splits as amounts (e.g. "0.0007") that sum exactly to charged_usdc.

Always call \`record_split\` exactly once with a complete allocation. Use \`flag_for_review\` if anything is abnormal (zero or multiple times is fine).

Output to user: write a 1-2 sentence plain-language summary of what you decided.`;

const TOOLS: LLMToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'lookup_track_splits',
      description: 'Read the configured royalty split for a track.',
      parameters: {
        type: 'object',
        properties: {
          track_id: { type: 'string' },
        },
        required: ['track_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_wallets',
      description: 'Check wallet state (exists? last_active? USDC balance?) for one or more users.',
      parameters: {
        type: 'object',
        properties: {
          user_ids: { type: 'array', items: { type: 'string' }, description: 'User IDs to check.' },
        },
        required: ['user_ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_split',
      description: 'Commit to the final allocation for this play. The amounts must sum to charged_usdc.',
      parameters: {
        type: 'object',
        properties: {
          play_id: { type: 'string' },
          allocations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                recipient_user_id: { type: 'string' },
                recipient_role: { type: 'string', description: 'artist | producer | featured | songwriter' },
                amount_usdc: { type: 'string', description: 'USDC amount as a decimal string (e.g. "0.0007").' },
              },
              required: ['recipient_user_id', 'recipient_role', 'amount_usdc'],
            },
          },
          reasoning: { type: 'string', description: 'Plain-language reasoning shown on the artist dashboard.' },
        },
        required: ['play_id', 'allocations', 'reasoning'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flag_for_review',
      description: 'Flag an issue with this split for human review. Optional but recommended when something is abnormal.',
      parameters: {
        type: 'object',
        properties: {
          play_id: { type: 'string' },
          reason: { type: 'string', description: 'Short description of the issue.' },
        },
        required: ['play_id', 'reason'],
      },
    },
  },
];

export interface SplitRow {
  recipient_user_id: string;
  recipient_wallet_address: string;
  share_bps: number;
  amount_usdc: string;
  role: string;
}

export interface SplitDecision {
  playId: string;
  trackId: string;
  chargedUsdc: string;
  splits: SplitRow[];
  reasoning: string;
  flagged: boolean;
  flagReason?: string;
  tokensUsed: number;
  durationMs: number;
}

/**
 * Run the Royalty Splitter Agent on a play. Idempotent — if already split, returns existing.
 */
export async function splitPlay(playId: string): Promise<SplitDecision> {
  const db = getDb();
  const start = Date.now();

  const play = db.prepare(`SELECT * FROM plays WHERE id = ?`).get(playId) as any;
  if (!play) throw new Error(`play not found: ${playId}`);

  // Idempotency
  const existing = db.prepare(`SELECT * FROM play_royalty_splits WHERE play_id = ?`).all(playId) as any[];
  if (existing.length > 0) {
    return {
      playId,
      trackId: play.track_id,
      chargedUsdc: play.charged_usdc,
      splits: existing.map((r) => ({
        recipient_user_id: r.recipient_user_id,
        recipient_wallet_address: r.recipient_wallet_address,
        share_bps: r.share_bps,
        amount_usdc: r.amount_usdc,
        role: r.role,
      })),
      reasoning: '(already split)',
      flagged: false,
      tokensUsed: 0,
      durationMs: Date.now() - start,
    };
  }

  // Resolve track + artist for fallback
  const track = db.prepare(`SELECT * FROM tracks WHERE id = ?`).get(play.track_id) as any;
  if (!track) throw new Error(`track not found: ${play.track_id}`);
  const artist = db.prepare(`SELECT * FROM artists WHERE id = ?`).get(track.artist_id) as any;

  // Tools (closures over play + track)
  const lookupTrackSplits = (params: any): string => {
    const rows = db.prepare(`
      SELECT trs.recipient_user_id, trs.role, trs.share_bps, u.email, u.display_name
      FROM track_royalty_splits trs
      JOIN users u ON u.id = trs.recipient_user_id
      WHERE trs.track_id = ?
      ORDER BY trs.share_bps DESC
    `).all(params.track_id) as any[];
    const totalBps = rows.reduce((s, r) => s + r.share_bps, 0);
    return JSON.stringify({
      track_id: params.track_id,
      configured_splits: rows,
      total_bps: totalBps,
      valid: totalBps === 10000,
      note: totalBps === 0
        ? 'No royalty config — default to 100% to the track artist'
        : totalBps === 10000
          ? 'Splits sum to 100% — proceed as configured'
          : `Splits sum to ${totalBps} bps (${(totalBps / 100).toFixed(2)}%) — INVALID, flag for review`,
    });
  };

  const lookupWallets = (params: any): string => {
    const ids = params.user_ids ?? [];
    const rows = db.prepare(`
      SELECT w.user_id, w.address, w.pin_setup_complete, u.last_seen_at
      FROM wallets w
      LEFT JOIN users u ON u.id = w.user_id
      WHERE w.user_id IN (${ids.map(() => '?').join(',') || "''"})
    `).all(...ids) as any[];
    return JSON.stringify({
      wallets: rows.map((r) => ({
        user_id: r.user_id,
        address: r.address,
        pin_setup_complete: !!r.pin_setup_complete,
        last_active_ms: r.last_seen_at,
        status: !r.address
          ? 'no_wallet'
          : r.last_seen_at && Date.now() - r.last_seen_at > 30 * 24 * 60 * 60 * 1000
            ? 'inactive_30d'
            : 'active',
      })),
    });
  };

  const recordSplit = (params: any): string => {
    if (!params.play_id || params.play_id !== playId) return JSON.stringify({ error: 'play_id mismatch' });
    const allocs = params.allocations;
    if (!Array.isArray(allocs) || allocs.length === 0) {
      return JSON.stringify({ error: 'allocations must be a non-empty array' });
    }
    // Sum check (allow $0.000001 tolerance)
    const total = allocs.reduce((s: number, a: any) => s + parseFloat(a.amount_usdc ?? '0'), 0);
    const expected = parseFloat(play.charged_usdc);
    if (Math.abs(total - expected) > 0.000001) {
      return JSON.stringify({ error: `allocations sum to ${total} but play charged ${expected}` });
    }

    const tx = db.transaction(() => {
      for (const a of allocs) {
        const wallet = db.prepare(`SELECT address FROM wallets WHERE user_id = ?`).get(a.recipient_user_id) as any;
        const addr = wallet?.address ?? '';
        db.prepare(`
          INSERT INTO play_royalty_splits (
            id, play_id, track_id, recipient_user_id, recipient_wallet_address,
            share_bps, amount_usdc, settled, settlement_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)
        `).run(
          randomUUID(),
          playId,
          play.track_id,
          a.recipient_user_id,
          addr,
          0, // share_bps no longer needed here (config is canonical), use 0 to indicate LLM-decided
          a.amount_usdc,
          Date.now(),
        );
      }
    });
    tx();

    return JSON.stringify({ ok: true, recorded: allocs.length });
  };

  const flagForReview = (params: any): string => {
    // We don't have a "review_queue" table — log it as an agent_runs annotation
    db.prepare(`
      INSERT INTO agent_runs (id, agent_type, user_id, input, output, tokens_used, duration_ms, status, error, created_at)
      VALUES (?, 'royalty_splitter', ?, ?, ?, 0, 0, 'flagged', ?, ?)
    `).run(
      randomUUID(),
      play.fan_user_id,
      `Flag play ${playId}`,
      params.reason ?? 'unspecified',
      params.reason ?? 'unspecified',
      Date.now(),
    );
    return JSON.stringify({ ok: true, flagged: true });
  };

  const userMessage = `Just settled a play. Decide how to split it.

play_id: ${playId}
track_id: ${play.track_id}
charged_usdc: ${play.charged_usdc}
track_title: ${track.title}
track_artist_id: ${track.artist_id}
track_artist_user_id: ${artist?.user_id ?? 'unknown'}

Use lookup_track_splits to read the config, lookup_wallets to verify wallets exist, then record_split to commit. Flag anything abnormal.`;

  const llmResult = await llmAgentLoop({
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    tools: TOOLS,
    executeTool: async (name, params) => {
      if (name === 'lookup_track_splits') return lookupTrackSplits(params);
      if (name === 'lookup_wallets') return lookupWallets(params);
      if (name === 'record_split') return recordSplit(params);
      if (name === 'flag_for_review') return flagForReview(params);
      return JSON.stringify({ error: `unknown tool: ${name}` });
    },
    maxSteps: 6,
    temperature: 0.1, // very deterministic for financial decisions
  });

  // Read what was actually recorded
  const recorded = db.prepare(`SELECT * FROM play_royalty_splits WHERE play_id = ?`).all(playId) as any[];
  const flaggedRow = db.prepare(`
    SELECT error FROM agent_runs
    WHERE agent_type = 'royalty_splitter' AND status = 'flagged' AND input = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(`Flag play ${playId}`) as any;

  // If LLM never recorded a split AND no rows exist, force a default split to primary artist
  if (recorded.length === 0) {
    const wallet = db.prepare(`SELECT address FROM wallets WHERE user_id = ?`).get(artist?.user_id) as any;
    db.prepare(`
      INSERT INTO play_royalty_splits (id, play_id, track_id, recipient_user_id, recipient_wallet_address, share_bps, amount_usdc, settled, settlement_id, created_at)
      VALUES (?, ?, ?, ?, ?, 10000, ?, 0, NULL, ?)
    `).run(randomUUID(), playId, play.track_id, artist?.user_id, wallet?.address ?? '', play.charged_usdc, Date.now());
  }

  const finalRecorded = db.prepare(`SELECT * FROM play_royalty_splits WHERE play_id = ?`).all(playId) as any[];

  // Log the run
  db.prepare(`
    INSERT INTO agent_runs (id, agent_type, user_id, input, output, tokens_used, duration_ms, status, created_at)
    VALUES (?, 'royalty_splitter', ?, ?, ?, ?, ?, 'success', ?)
  `).run(
    randomUUID(),
    play.fan_user_id,
    userMessage.slice(0, 500),
    llmResult.finalContent.slice(0, 500),
    llmResult.totalTokens,
    Date.now() - start,
    Date.now(),
  );

  return {
    playId,
    trackId: play.track_id,
    chargedUsdc: play.charged_usdc,
    splits: finalRecorded.map((r) => ({
      recipient_user_id: r.recipient_user_id,
      recipient_wallet_address: r.recipient_wallet_address,
      share_bps: r.share_bps,
      amount_usdc: r.amount_usdc,
      role: db.prepare(`SELECT role FROM track_royalty_splits WHERE track_id = ? AND recipient_user_id = ? ORDER BY share_bps DESC LIMIT 1`)
        .get(r.track_id, r.recipient_user_id) as any ??
        'artist',
    })),
    reasoning: llmResult.finalContent,
    flagged: !!flaggedRow,
    flagReason: flaggedRow?.error,
    tokensUsed: llmResult.totalTokens,
    durationMs: Date.now() - start,
  };
}

/**
 * Get the current royalty split config for a track (artist-facing).
 */
export function getTrackSplits(trackId: string): Array<{ recipient_user_id: string; role: string; share_bps: number }> {
  const db = getDb();
  return db.prepare(`
    SELECT recipient_user_id, role, share_bps
    FROM track_royalty_splits
    WHERE track_id = ?
    ORDER BY share_bps DESC
  `).all(trackId) as any[];
}

/**
 * Update the royalty split config for a track. Validates shares sum to 10000 bps.
 * Artist-only can update their own tracks.
 */
export function setTrackSplits(
  trackId: string,
  splits: Array<{ recipient_user_id: string; role: string; share_bps: number }>,
): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(splits) || splits.length === 0) {
    return { ok: false, error: 'splits must be a non-empty array' };
  }
  const total = splits.reduce((s, x) => s + x.share_bps, 0);
  if (total !== 10000) {
    return { ok: false, error: `shares must sum to 10000 bps (100%); got ${total}` };
  }
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM track_royalty_splits WHERE track_id = ?`).run(trackId);
    for (const s of splits) {
      db.prepare(`
        INSERT INTO track_royalty_splits (id, track_id, recipient_user_id, role, share_bps, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), trackId, s.recipient_user_id, s.role, s.share_bps, Date.now());
    }
  });
  tx();
  return { ok: true };
}