/**
 * Email service — transactional email for auth flows (verification, reset).
 *
 * For hackathon/demo: falls back to ethereal.email (auto-generated test SMTP
 * server, viewable at the returned preview URL). For production: set
 * SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM env vars to use
 * any real SMTP (Mailgun, SendGrid, SES, Postmark, etc.).
 *
 * The transport is initialized once and cached.
 */
import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';

interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

interface EmailResult {
  ok: boolean;
  previewUrl?: string;   // ethereal only
  error?: string;
}

let transport: nodemailer.Transporter | null = null;
let usingEthereal = false;
let etherealFromAddress = '';

async function getTransport(): Promise<nodemailer.Transporter> {
  if (transport) return transport;

  // Real SMTP if env vars are set
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    usingEthereal = false;
    return transport;
  }

  // Ethereal fallback — auto-creates a test inbox, returns preview URL
  const test = await nodemailer.createTestAccount();
  transport = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: { user: test.user, pass: test.pass },
  });
  usingEthereal = true;
  etherealFromAddress = test.user;
  console.log('[email] using ethereal.email test SMTP. From:', test.user);
  return transport;
}

const FROM = process.env.SMTP_FROM ?? 'Pazzera <noreply@pazzera.com>';

export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  try {
    const t = await getTransport();
    const info = await t.sendMail({
      from: FROM,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text ?? msg.html.replace(/<[^>]+>/g, ''),
    });
    if (usingEthereal) {
      const previewUrl = nodemailer.getTestMessageUrl(info) ?? undefined;
      console.log(`[email] preview: ${previewUrl}`);
      return { ok: true, previewUrl };
    }
    return { ok: true };
  } catch (e: any) {
    console.error('[email] send failed:', e?.message ?? e);
    return { ok: false, error: e?.message ?? String(e) };
  }
}

export function emailTemplates() {
  return {
    verification: (verifyUrl: string, displayName: string) => ({
      subject: 'Verify your Pazzera email',
      html: `
        <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <h1 style="font-size:24px;margin:0 0 16px;">Welcome to Pazzera, ${esc(displayName)}!</h1>
          <p>Click the button below to verify your email address. The link expires in 24 hours.</p>
          <p style="margin:32px 0;">
            <a href="${verifyUrl}" style="background:#1db954;color:#000;padding:14px 28px;border-radius:999px;text-decoration:none;font-weight:700;display:inline-block;">Verify email</a>
          </p>
          <p style="color:#888;font-size:13px;">Or paste this URL: <br><code>${verifyUrl}</code></p>
          <p style="color:#888;font-size:13px;margin-top:32px;">If you didn't sign up for Pazzera, ignore this email.</p>
        </div>
      `,
    }),

    passwordReset: (resetUrl: string, displayName: string) => ({
      subject: 'Reset your Pazzera password',
      html: `
        <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <h1 style="font-size:24px;margin:0 0 16px;">Password reset</h1>
          <p>Hi ${esc(displayName)}, click below to set a new password. The link expires in 1 hour.</p>
          <p style="margin:32px 0;">
            <a href="${resetUrl}" style="background:#1db954;color:#000;padding:14px 28px;border-radius:999px;text-decoration:none;font-weight:700;display:inline-block;">Reset password</a>
          </p>
          <p style="color:#888;font-size:13px;">If you didn't request this, ignore this email — your password won't change.</p>
        </div>
      `,
    }),

    welcomeWithWallet: (displayName: string, walletAddress: string, faucetUrl: string) => ({
      subject: 'Your Pazzera wallet is ready',
      html: `
        <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <h1 style="font-size:24px;margin:0 0 16px;">You're all set, ${esc(displayName)}.</h1>
          <p>Your Pazzera wallet is live on Arc Testnet:</p>
          <p style="background:#181818;padding:12px 16px;border-radius:8px;font-family:monospace;font-size:13px;word-break:break-all;">${walletAddress}</p>
          <p>To start listening, you'll need testnet USDC. Get some from the faucet:</p>
          <p style="margin:24px 0;">
            <a href="${faucetUrl}" style="background:#1db954;color:#000;padding:14px 28px;border-radius:999px;text-decoration:none;font-weight:700;display:inline-block;">Get testnet USDC</a>
          </p>
          <p style="color:#888;font-size:13px;margin-top:32px;">The faucet is run by Circle and tops up testnet USDC for free. No real money involved.</p>
        </div>
      `,
    }),
  };
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
}

export function generateToken(bytes = 32): string {
  return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, bytes);
}