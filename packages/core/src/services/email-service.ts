/**
 * Email service — Resend integration with a branded dark-themed template.
 *
 * Falls back to console.log in dev when RESEND_API_KEY is missing so
 * the dev environment can be exercised without a real Resend account.
 */
import { Resend } from 'resend';
import { getEnv, logger } from '../index';
import { recordAuthEvent } from './auth-events';

let resendClient: Resend | null = null;

function getClient(): Resend | null {
  if (resendClient) return resendClient;
  const env = (() => {
    try { return getEnv(); } catch { return null; }
  })();
  if (!env?.RESEND_API_KEY || env.RESEND_API_KEY === 're_xxx_replace_me') {
    return null;
  }
  resendClient = new Resend(env.RESEND_API_KEY);
  return resendClient;
}

export interface SendOtpEmailInput {
  to: string;
  code: string;
  expiresAt: Date;
  ipHash?: string | null;
  userAgent?: string | null;
}

export async function sendOtpEmail(input: SendOtpEmailInput): Promise<{ delivered: boolean; provider: 'resend' | 'console' }> {
  const env = getEnv();
  const minutes = Math.max(1, Math.round((input.expiresAt.getTime() - Date.now()) / 60_000));
  const html = renderOtpEmail({ code: input.code, minutes });
  const subject = 'Your Pazzera Sign-In Code';

  const client = getClient();
  if (!client) {
    logger.warn(
      { to: input.to, code: input.code, minutes },
      'email:dev_console: OTP code (Resend not configured)',
    );
    return { delivered: true, provider: 'console' };
  }

  try {
    const { error } = await client.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to: input.to,
      subject,
      html,
    });
    if (error) {
      logger.error({ err: error, to: input.to }, 'email:send_failed');
      await recordAuthEvent({
        type: 'email_send_failed',
        email: input.to,
        ipHash: input.ipHash,
        userAgent: input.userAgent,
        severity: 5,
        meta: { error: String(error) },
      });
      return { delivered: false, provider: 'resend' };
    }
    await recordAuthEvent({
      type: 'otp_delivered',
      email: input.to,
      ipHash: input.ipHash,
      userAgent: input.userAgent,
    });
    return { delivered: true, provider: 'resend' };
  } catch (err) {
    logger.error({ err, to: input.to }, 'email:send_threw');
    return { delivered: false, provider: 'resend' };
  }
}

// ─── Template ────────────────────────────────────────────────────────

function renderOtpEmail({ code, minutes }: { code: string; minutes: number }): string {
  // Inline-styled, dark-aesthetic email. No external assets (CSP-safe, also loads in dark-mode email clients).
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="color-scheme" content="dark" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Your Pazzera Sign-In Code</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#fafafa;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0a0a0a;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellspacing="0" cellpadding="0" border="0" style="max-width:480px;width:100%;">
          <tr>
            <td align="center" style="padding:24px 0 8px 0;">
              <div style="font-size:28px;font-weight:700;letter-spacing:-0.02em;background:linear-gradient(90deg,#fafafa 0%,#9be15d 100%);-webkit-background-clip:text;background-clip:text;color:transparent;">
                Pazzera
              </div>
              <div style="color:#9ca3af;font-size:13px;margin-top:4px;">Pay per listen. Own your sound.</div>
            </td>
          </tr>
          <tr>
            <td style="background:#111;border:1px solid #1f1f1f;border-radius:16px;padding:32px;margin-top:16px;">
              <h1 style="margin:0 0 8px 0;font-size:22px;font-weight:600;color:#fafafa;">Your sign-in code</h1>
              <p style="margin:0 0 24px 0;color:#9ca3af;font-size:14px;line-height:1.5;">
                Use the code below to finish signing in. It expires in <strong style="color:#fafafa;">${minutes} minutes</strong>.
              </p>
              <div style="background:#0a0a0a;border:1px solid #262626;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
                <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:36px;font-weight:700;letter-spacing:0.4em;color:#9be15d;">${code}</div>
              </div>
              <p style="margin:0 0 8px 0;color:#9ca3af;font-size:13px;line-height:1.5;">
                If you didn't request this code, you can safely ignore this email — no one can sign in without it.
              </p>
              <p style="margin:0;color:#6b7280;font-size:12px;line-height:1.5;">
                Never share this code with anyone. Pazzera will never ask for it.
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 0 0 0;color:#6b7280;font-size:11px;line-height:1.5;">
              <div>Pazzera &middot; <a href="https://pazzera.com" style="color:#9be15d;text-decoration:none;">pazzera.com</a></div>
              <div style="margin-top:4px;">Decentralized music streaming on Arc.</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}