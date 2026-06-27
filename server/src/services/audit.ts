/**
 * Audit log — security-sensitive action recorder. Writes to the audit_log
 * table with user id, IP, user-agent, action, and JSON metadata.
 */
import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';
import type { Request } from 'express';

export type AuditAction =
  | 'signup'
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'password_reset_requested'
  | 'password_reset_completed'
  | 'email_verification_sent'
  | 'email_verification_completed'
  | 'account_locked'
  | 'account_unlocked'
  | '2fa_enabled'
  | '2fa_disabled'
  | 'profile_updated'
  | 'wallet_provisioned'
  | 'wallet_pin_completed'
  | 'play_charged'
  | 'account_deleted';

export function audit(
  req: Request | null,
  action: AuditAction,
  options: { userId?: string | null; metadata?: Record<string, any>; fields?: string[]; method?: string } = {},
): void {
  try {
    const db = getDb();
    const ip = req?.ip ?? req?.socket?.remoteAddress ?? null;
    const ua = req?.get?.('user-agent') ?? null;
    db.prepare(`
      INSERT INTO audit_log (id, user_id, action, ip_address, user_agent, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      options.userId ?? null,
      action,
      ip,
      ua ? ua.slice(0, 500) : null,
      options.metadata ? JSON.stringify(options.metadata) : null,
      Date.now(),
    );
  } catch (e) {
    // Audit failure should never block the main operation
    console.error('[audit] failed to write log:', e);
  }
}