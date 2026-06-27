# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |
| < 0.2   | :x:                |

## Reporting a Vulnerability

We take security seriously. If you discover a vulnerability in Pazzera, please report it privately.

**Email**: security@pazzera.com (or DM @ruzkypazzy on Telegram)

**What to include**:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Your contact info (optional, for follow-up)

**What to expect**:
- Acknowledgement within 48 hours
- Status update within 7 days
- Fix timeline communicated clearly
- Public disclosure after the fix ships

We follow responsible disclosure. Please don't open public issues for security bugs.

## Security Architecture

### User authentication
- **Password hashing**: bcryptjs cost factor 12 (~250ms per hash, balances security + UX)
- **Sessions**: JWT HS256, 7-day expiry, signed with `JWT_SECRET`
- **Cookies**: `httpOnly`, `sameSite=lax`, `secure` in production (Railway handles HTTPS)
- **Account lockout**: 5 failed logins in a row → 15-minute lock

### Account protection
- **Password reset**: 1-hour single-use tokens, stored as SHA-256 hashes (not plain)
- **Email verification**: 24-hour single-use tokens, same hash-at-rest treatment
- **Rate limiting**: per-IP, per-endpoint buckets (5/hr signup, 10/15min login, 3/hr forgot-password)
- **2FA**: TOTP planned (currently stubbed)

### Data at rest
- **Circle W3S tokens**: AES-256-GCM encrypted with `ENCRYPTION_KEY` (SHA-256 derived from any-length input)
- **Password reset tokens**: SHA-256 hashed (not reversible, even with DB access)
- **Email verification tokens**: SHA-256 hashed
- **Database**: SQLite (dev) / Postgres (prod recommended). On Neon, TLS enforced via `sslmode=require`.

### Transport security
- **Frontend → Backend**: HTTPS only, enforced by Cloudflare + Railway
- **Backend → Circle**: HTTPS, API key auth
- **Backend → Arc RPC**: HTTPS, public RPC
- **CORS**: strict allowlist (no `*`), explicit list in `ALLOWED_ORIGINS` env var
- **Security headers**: helmet sets X-Frame-Options, X-Content-Type-Options, Referrer-Policy

### Money flow
- **x402 EIP-712 signatures**: typed data is `TransferWithAuthorization` (USDC V2 standard) with bounded `validAfter`/`validBefore`
- **Verification**: viem's `recoverTypedDataAddress` confirms signer matches wallet owner
- **Settlement**: Circle Gateway facilitator (no on-chain direct call from backend)
- **Replay protection**: nonce per play + server-side settlement_id tracking
- **Skip-gating**: < 10s listen is free, replay within 30s is free (limits abuse)

### What we DON'T do
- We do NOT custody user funds. Circle W3S wallets are user-controlled.
- We do NOT store raw credit card / bank data.
- We do NOT share user data with third parties.
- We do NOT log passwords (even hashed).

### Known limitations
- Email verification works via ethereal.email fallback for demo (no real SMTP). Set `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` in production.
- 2FA is stubbed (TOTP not yet wired). For high-value accounts, add before launch.
- No CSRF protection on state-changing endpoints (relies on `sameSite=lax` cookie + CORS allowlist). Add CSRF tokens for production.
- Avatar upload accepts any image type/size up to 5MB. Consider virus scanning in production.
- SQLite is dev-grade. For production traffic, migrate to Neon Postgres (see ARCHITECTURE.md).

### Audit log

Every security-sensitive action is recorded in the `audit_log` table:

| Action | When |
|---|---|
| `signup` | New user created |
| `login` / `login_failed` | Auth attempt |
| `logout` | Session cleared |
| `password_reset_requested` / `password_reset_completed` | Reset flow |
| `email_verification_sent` / `email_verification_completed` | Verify flow |
| `account_locked` | Hit failed_login_count threshold |
| `2fa_enabled` / `2fa_disabled` | TOTP toggled |
| `profile_updated` | Account fields changed |
| `wallet_provisioned` / `wallet_pin_completed` | Circle wallet flow |
| `play_charged` | x402 payment settled |
| `account_deleted` | User removed |

Each row records `user_id`, `action`, `ip_address`, `user_agent`, `metadata` (JSON), `created_at`.

## Third-party services

| Service | Purpose | What we share |
|---|---|---|
| Circle W3S | Wallet provisioning + x402 signing | Email (Circle user_id), tx hashes |
| Arc Testnet RPC | USDC balance, tx receipts | Wallet address (read-only) |
| Circle Gateway | Payment settlement | Signed EIP-712 typed data |
| Cloudflare | DNS + CDN + Pages | Standard HTTP request metadata |
| Railway | Hosting | None (just runs our code) |

We do not share data with advertisers, analytics providers, or social platforms.

## Compliance notes

- **GDPR**: User data export + deletion endpoints available (`DELETE /api/account`)
- **Data residency**: All data in US-West (Railway us-west, Neon us-west-2)
- **Cookie consent**: Not yet implemented (frontend uses only essential cookies)
- **Privacy policy**: To be published before public launch

For questions, contact security@pazzera.com.
