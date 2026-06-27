/**
 * Fan Agent — autonomous music discovery + playback + payment on behalf of a fan.
 *
 * The Fan Agent is NOT a listener. The fan listens. The agent:
 *   1. Receives a fan's intent ("play afrobeat by Burna Boy")
 *   2. Searches Pazzera's catalog (SQLite FTS or LIKE search)
 *   3. Picks a track that matches
 *   4. Issues the x402 challenge (POST /play/start on the fan's behalf)
 *   5. With the fan's stored Circle W3S userToken (encrypted at rest), the
 *      backend signs the EIP-712 TransferWithAuthorization in-server
 *   6. Submits to Circle Gateway facilitator
 *   7. Records the play + triggers the Royalty Splitter Agent
 *   8. Returns to the fan: "I played X by Y, paid $0.001 USDC directly to
 *      their wallet via Arc. Track it on the explorer."
 *
 * Budget enforcement:
 *   - Per-session and per-day caps stored on fan_agent_profiles
 *   - Agent refuses to play if remaining budget < track's price_per_listen
 *
 * Wallet safety:
 *   - The fan's Circle userToken + encryptionKey are decrypted only at the
 *     moment of signing, used to create the EIP-712 signature, then dropped.
 *   - No long-lived agent wallet. The fan's real wallet is the one paying.
 *
 * LLM usage:
 *   - The LLM is used for intent extraction ("play afrobeat" → query params),
 *     track ranking, and the final response message to the fan.
 *   - The actual financial action (x402 sign + Gateway submit) is deterministic
 *     code, NOT LLM output. The LLM cannot accidentally send money — it can
 *     only call our internal tools which check budgets and sign locally.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../../db.js';
import { decryptString } from '../crypto.js';
import { verifyX402Payment, submitToGateway, usdcUnits, formatUsdc } from '../circle.js';
import { llmAgentLoop, LLMToolDef } from '../llm.js';
import { splitPlay } from './royalty-splitter.js';

const SYSTEM_PROMPT = `You are the Fan Agent for Pazzera, a pay-per-listen music platform on Arc.

A fan has asked you to find and play music. Your job:
1. Parse their intent (what artist, genre, mood, era, song name?)
2. Use the \`search_catalog\` tool to find matching tracks.
3. Use \`pick_track\` to commit to ONE track (the best match).
4. Use \`play_track\` to actually start playback + payment on their behalf.
   The play_track tool will: check budget, sign x402 authorization, submit
   to Circle Gateway, settle on Arc, record the play, and run the Royalty
   Splitter Agent to route the payment to the artist(s).
5. After play_track returns, write a short 1-2 sentence response telling the
   fan what you played, what it cost, and where the money went.

Hard rules:
- NEVER call play_track more than once per turn (no replays).
- If search_catalog returns no tracks, tell the fan honestly and stop.
- Do not invent tracks — only use what search_catalog returns.
- Be concise. No emoji, no marketing language. Plain text.

Budget: you cannot exceed the fan's per-session or per-day budget. If a track
is too expensive for the remaining budget, pick a cheaper track or stop.`;

const TOOLS: LLMToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'search_catalog',
      description: 'Search the Pazzera catalog for tracks matching a query. Returns up to 8 results.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free-text search (artist, title, mood, genre).' },
          genre: { type: 'string', description: 'Optional genre filter (e.g. "afrobeat", "lofi").' },
          max_results: { type: 'integer', description: 'Max results to return (default 5).' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pick_track',
      description: 'Commit to a single track from the search results. Cannot change after.',
      parameters: {
        type: 'object',
        properties: {
          track_id: { type: 'string' },
          reason: { type: 'string', description: 'Why this track (for the fan).' },
        },
        required: ['track_id', 'reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'play_track',
      description: 'Actually play the picked track and pay the artist on the fan\'s behalf via x402 + Arc.',
      parameters: {
        type: 'object',
        properties: {
          track_id: { type: 'string' },
        },
        required: ['track_id'],
      },
    },
  },
];

export interface FanAgentResult {
  finalMessage: string;
  trackPlayed?: {
    trackId: string;
    title: string;
    artistName: string;
    chargedUsdc: string;
    settlementId?: string;
    playId: string;
    splits: Array<{ recipient_role: string; amount_usdc: string }>;
  };
  budget: {
    sessionSpentUsdc: string;
    sessionCapUsdc: string;
    daySpentUsdc: string;
    dayCapUsdc: string;
  };
  tokensUsed: number;
  durationMs: number;
}

/**
 * Run the Fan Agent for one fan request.
 *
 * IMPORTANT: this is the only function in the agent layer that takes a real
 * Circle userToken and signs real x402 authorizations. Everything else is
 * read-only or DB writes.
 */
export async function runFanAgent(args: {
  userId: string;
  userMessage: string;
  circleUserToken?: string; // optional — if missing, agent can't pay, will explain
}): Promise<FanAgentResult> {
  const db = getDb();
  const start = Date.now();

  // 1. Load or create the fan's agent profile
  const profile = getOrCreateProfile(args.userId);
  resetBudgetIfNewDay(profile);

  // 2. Search tool — closure over the profile so we can budget-check
  let pickedTrack: any = null;
  let playResult: any = null;

  const searchCatalog = (params: any): string => {
    const q = String(params.query ?? '').trim();
    const max = Number(params.max_results ?? 5);
    const rows = db.prepare(`
      SELECT t.id, t.title, t.description, t.duration_seconds, t.price_per_listen_usdc,
             a.display_name AS artist_name
      FROM tracks t
      JOIN artists a ON a.id = t.artist_id
      WHERE t.published = 1
        AND (t.title LIKE ? OR a.display_name LIKE ? OR t.description LIKE ?)
      ORDER BY t.plays_count DESC, t.created_at DESC
      LIMIT ?
    `).all(`%${q}%`, `%${q}%`, `%${q}%`, max) as any[];
    return JSON.stringify({
      count: rows.length,
      tracks: rows.map((r) => ({
        id: r.id,
        title: r.title,
        artist_name: r.artist_name,
        price_per_listen_usdc: r.price_per_listen_usdc,
        duration_seconds: r.duration_seconds,
      })),
    });
  };

  const pickTrack = (params: any): string => {
    if (pickedTrack) return JSON.stringify({ error: 'track already picked' });
    const row = db.prepare(`
      SELECT t.*, a.display_name AS artist_name, w.address AS artist_wallet
      FROM tracks t
      JOIN artists a ON a.id = t.artist_id
      LEFT JOIN wallets w ON w.user_id = a.user_id
      WHERE t.id = ?
    `).get(params.track_id) as any;
    if (!row) return JSON.stringify({ error: 'track not found' });
    pickedTrack = row;
    return JSON.stringify({
      id: row.id,
      title: row.title,
      artist_name: row.artist_name,
      price_per_listen_usdc: row.price_per_listen_usdc,
      artist_wallet: row.artist_wallet,
    });
  };

  const playTrack = async (params: any): Promise<string> => {
    if (!pickedTrack || pickedTrack.id !== params.track_id) {
      return JSON.stringify({ error: 'must pick_track first' });
    }
    const priceUsdc = parseFloat(pickedTrack.price_per_listen_usdc);
    const remainingSession = parseFloat(profile.budget_per_session_usdc) - parseFloat(profile.spent_today_usdc); // simplified
    const remainingDay = parseFloat(profile.budget_per_day_usdc) - parseFloat(profile.spent_today_usdc);
    const remaining = Math.min(remainingSession, remainingDay);
    if (priceUsdc > remaining) {
      return JSON.stringify({ error: `over budget — need ${priceUsdc} USDC, only ${remaining.toFixed(6)} left` });
    }

    if (!args.circleUserToken) {
      return JSON.stringify({
        error: 'cannot sign payment — fan needs to complete Circle PIN setup first',
      });
    }

    // Build the x402 challenge and sign it in-server
    const playId = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const validAfter = now - 60;
    const validBefore = now + 60 * 60; // 1 hour window
    const nonce = '0x' + randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 64);
    const value = usdcUnits(pickedTrack.price_per_listen_usdc);

    // Resolve fan wallet address (signer) — must be Circle-controlled
    const fanWallet = db.prepare(`SELECT address FROM wallets WHERE user_id = ?`).get(args.userId) as any;
    if (!fanWallet) return JSON.stringify({ error: 'fan has no wallet' });

    // Use Circle SDK to sign the EIP-712 message
    // (Circle W3S exposes a signTypedData call we use in-server)
    let signature: string;
    try {
      signature = await signTransferWithAuth({
        userToken: args.circleUserToken,
        payer: fanWallet.address,
        payee: pickedTrack.artist_wallet,
        value,
        validAfter,
        validBefore,
        nonce,
      });
    } catch (e: any) {
      return JSON.stringify({ error: `sign failed: ${e?.message ?? e}` });
    }

    const auth = {
      payer: fanWallet.address,
      payee: pickedTrack.artist_wallet,
      value,
      validAfter,
      validBefore,
      nonce,
      signature,
    };

    // Verify
    const verify = await verifyX402Payment(auth);
    if (!verify.ok) {
      return JSON.stringify({ error: `x402 verify failed: ${verify.reason ?? 'unknown'}` });
    }

    // Submit to Circle Gateway
    let settlementId: string;
    try {
      const sub = await submitToGateway(auth);
      settlementId = sub.settlementId;
    } catch (e: any) {
      return JSON.stringify({ error: `gateway submit failed: ${e?.message ?? e}` });
    }

    // Record play
    db.prepare(`
      INSERT INTO plays (id, track_id, fan_user_id, fan_wallet_address, listened_seconds,
                         charged_usdc, settled, settlement_id, skipped, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, 0, ?)
    `).run(playId, pickedTrack.id, args.userId, fanWallet.address, pickedTrack.duration_seconds, pickedTrack.price_per_listen_usdc, settlementId, Date.now());

    // Update track stats
    db.prepare(`UPDATE tracks SET plays_count = plays_count + 1, earnings_usdc = printf('%.6f', earnings_usdc + ?) WHERE id = ?`)
      .run(parseFloat(pickedTrack.price_per_listen_usdc), pickedTrack.id);

    // Trigger Royalty Splitter Agent
    const split = await splitPlay(playId);

    // Update fan agent profile budgets
    const newSpent = (parseFloat(profile.spent_today_usdc) + priceUsdc).toFixed(6);
    db.prepare(`
      UPDATE fan_agent_profiles
      SET spent_today_usdc = ?, spent_total_usdc = printf('%.6f', spent_total_usdc + ?),
          total_agent_plays = total_agent_plays + 1, updated_at = ?
      WHERE user_id = ?
    `).run(newSpent, priceUsdc, Date.now(), args.userId);

    playResult = {
      playId,
      trackId: pickedTrack.id,
      title: pickedTrack.title,
      artistName: pickedTrack.artist_name,
      chargedUsdc: pickedTrack.price_per_listen_usdc,
      settlementId,
      splits: split.splits.map((s: any) => ({ recipient_role: s.role, amount_usdc: s.amount_usdc })),
    };
    return JSON.stringify({ ok: true, playId, settlementId, splits: split.splits });
  };

  const tools: LLMToolDef[] = TOOLS;
  const llmResult = await llmAgentLoop({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: args.userMessage,
    tools,
    executeTool: async (name, params) => {
      if (name === 'search_catalog') return searchCatalog(params);
      if (name === 'pick_track') return pickTrack(params);
      if (name === 'play_track') return await playTrack(params);
      return JSON.stringify({ error: `unknown tool: ${name}` });
    },
    maxSteps: 5,
    temperature: 0.5,
  });

  // Log agent run
  db.prepare(`
    INSERT INTO agent_runs (id, agent_type, user_id, input, output, tokens_used, duration_ms, status, created_at)
    VALUES (?, 'fan', ?, ?, ?, ?, ?, 'success', ?)
  `).run(randomUUID(), args.userId, args.userMessage, llmResult.finalContent, llmResult.totalTokens, Date.now() - start, Date.now());

  // Refresh profile to return updated budget
  const fresh = getOrCreateProfile(args.userId);

  return {
    finalMessage: llmResult.finalContent,
    trackPlayed: playResult,
    budget: {
      sessionSpentUsdc: fresh.spent_today_usdc, // simplified — session == day for v1
      sessionCapUsdc: fresh.budget_per_session_usdc,
      daySpentUsdc: fresh.spent_today_usdc,
      dayCapUsdc: fresh.budget_per_day_usdc,
    },
    tokensUsed: llmResult.totalTokens,
    durationMs: Date.now() - start,
  };
}

// ─── Helpers ─────────────────────────────────────────────────

function getOrCreateProfile(userId: string): any {
  const db = getDb();
  let p = db.prepare(`SELECT * FROM fan_agent_profiles WHERE user_id = ?`).get(userId) as any;
  if (!p) {
    const now = Date.now();
    db.prepare(`
      INSERT INTO fan_agent_profiles (
        user_id, enabled, preferences,
        budget_per_session_usdc, budget_per_day_usdc,
        spent_today_usdc, spent_total_usdc,
        last_reset_at, total_agent_plays, created_at, updated_at
      ) VALUES (?, 0, '{}', '1.00', '5.00', '0', '0', ?, 0, ?, ?)
    `).run(userId, now, now, now);
    p = db.prepare(`SELECT * FROM fan_agent_profiles WHERE user_id = ?`).get(userId) as any;
  }
  return p;
}

function resetBudgetIfNewDay(profile: any) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  if (now - profile.last_reset_at > dayMs) {
    const db = getDb();
    db.prepare(`UPDATE fan_agent_profiles SET spent_today_usdc = '0', last_reset_at = ? WHERE user_id = ?`)
      .run(now, profile.user_id);
  }
}

export function setFanPreferences(args: {
  userId: string;
  preferences?: Record<string, unknown>;
  budgetPerSessionUsdc?: string;
  budgetPerDayUsdc?: string;
  enabled?: boolean;
}): any {
  const db = getDb();
  const profile = getOrCreateProfile(args.userId);
  const now = Date.now();
  const newPrefs = args.preferences ? JSON.stringify({ ...JSON.parse(profile.preferences), ...args.preferences }) : profile.preferences;
  db.prepare(`
    UPDATE fan_agent_profiles
    SET preferences = ?,
        budget_per_session_usdc = COALESCE(?, budget_per_session_usdc),
        budget_per_day_usdc = COALESCE(?, budget_per_day_usdc),
        enabled = COALESCE(?, enabled),
        updated_at = ?
    WHERE user_id = ?
  `).run(
    newPrefs,
    args.budgetPerSessionUsdc ?? null,
    args.budgetPerDayUsdc ?? null,
    args.enabled === undefined ? null : (args.enabled ? 1 : 0),
    now,
    args.userId,
  );
  return db.prepare(`SELECT * FROM fan_agent_profiles WHERE user_id = ?`).get(args.userId);
}

export function getFanProfile(userId: string): any {
  return getOrCreateProfile(userId);
}

// ─── Circle SDK signing ──────────────────────────────────────

/**
 * Sign an EIP-712 TransferWithAuthorization using Circle W3S.
 * Uses the SDK's signTypedData method exposed for user-controlled wallets.
 */
async function signTransferWithAuth(args: {
  userToken: string;
  payer: string;
  payee: string;
  value: string;
  validAfter: number;
  validBefore: number;
  nonce: string;
}): Promise<string> {
  const { initiateUserControlledWalletsClient } = await import('@circle-fin/user-controlled-wallets');
  const circle = initiateUserControlledWalletsClient({
    apiKey: process.env.CIRCLE_API_KEY ?? '',
  });
  const USDC = process.env.ARC_USDC_CONTRACT ?? '0x3600000000000000000000000000000000000000';
  const CHAIN_ID = Number(process.env.ARC_CHAIN_ID ?? 5042002);

  const data = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    domain: { name: 'USDC', version: '2', chainId: CHAIN_ID, verifyingContract: USDC },
    message: {
      from: args.payer,
      to: args.payee,
      value: args.value,
      validAfter: args.validAfter,
      validBefore: args.validBefore,
      nonce: args.nonce,
    },
  } as const;

  // Circle's W3S exposes signTypedData via the SDK; we delegate to it
  const result = await (circle as any).signTypedData({
    userToken: args.userToken,
    data: JSON.stringify(data),
  });
  return (result as any).data?.signature ?? (result as any).signature;
}