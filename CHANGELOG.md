# Changelog

All notable changes to Pazzera are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] — Phase 1 + 2 + 3

### Added
- **Backend hardening** (Phase 1, commit `2a8d851`)
  - Schema: bio, avatar_url, location, social_links, email_verified, two_factor_enabled, last_seen_at, failed_login_count, locked_until on users
  - New tables: `password_resets`, `sessions`, `follows`, `uploads`, `rate_limits`, `audit_log`
  - Encrypted at-rest columns: `circle_user_token_enc`, `circle_encryption_key_enc`
  - `/api/account` (GET, PATCH, avatar upload, change-password, verify-email, wallet, refresh-balance, complete-pin, delete)
  - `/api/auth/forgot-password` + `/reset-password` with hashed tokens
  - AES-256-GCM at-rest encryption (`services/crypto.ts`)
  - nodemailer + ethereal.email fallback (`services/email.ts`)
  - Per-IP rate limiters (5/hr signup, 10/15min login, 3/hr forgot-password)
  - Security audit log on every sensitive action
  - Account lockout (5 fails → 15min lock)
  - helmet security headers
  - `/ready` endpoint
  - strict CORS allowlist (no wildcards)
- **Vitest test suite** (Phase 2, this commit)
  - 31 tests, 100% pass
  - `tests/auth.test.ts` — signup, login, logout, lockout, validation
  - `tests/account.test.ts` — profile GET/PATCH, avatar, password change, delete
  - `tests/password-reset.test.ts` — forgot/reset flow with token expiry + reuse
  - Supertest + mocked Circle SDK for fast, isolated runs
- **Documentation**
  - `ARCHITECTURE.md` — system diagram, schema, auth/payment flows, security model, Neon Postgres migration path
  - `SECURITY.md` — vulnerability reporting, security architecture, audit log
  - `CONTRIBUTING.md` — dev setup, code style, PR process
- **Accessibility** (Phase 3, this commit)
  - Skip-to-content link
  - ARIA labels on player controls, nav, listening pill
  - `role="banner"`, `role="main"`, `role="navigation"`, `role="region"`, `role="status"`, `aria-live="polite"` on toast
  - Semantic `<header>`, `<nav>`, `<main>` landmarks
  - Focus-visible outline (keyboard navigation)
  - `prefers-reduced-motion` + `prefers-contrast` media queries
  - `.sr-only` utility for screen-reader text
- **SEO / PWA** (Phase 3)
  - Open Graph + Twitter card meta tags
  - `manifest.json` for installable PWA
  - `robots.txt` + `sitemap.xml`
- **404 page** — branded gradient with suggestion buttons

### Changed
- `auth.ts` — adds rate limit, account lockout, audit, AES-encrypted token storage, separate `/refresh-circle-token` endpoint
- `account.ts` — full CRUD for user profile with audit logging
- `password-reset.ts` — uses `hashToken()` for storage, single-use tokens with expiry
- CORS — strict allowlist from env or sensible defaults
- `.env.example` — adds `ENCRYPTION_KEY`, `ALLOWED_ORIGINS`, `UPLOADS_DIR`, SMTP config

### Security
- Circle userToken + encryptionKey encrypted at rest with AES-256-GCM
- Password reset tokens stored as SHA-256 hashes (not plaintext)
- Account lockout after 5 failed logins (15min)
- Rate limit on all auth endpoints (signup, login, forgot-password, verify-email)
- Audit log on every security-sensitive operation
- helmet sets HSTS, X-Frame-Options, X-Content-Type-Options, etc.
- CORS no longer accepts `*` — uses explicit allowlist
- File uploads: type-validated (PNG/JPEG/WebP), size-limited (8MB)

## [0.1.0] — Initial release (hackathon MVP)

### Added
- Email + password auth with bcryptjs + JWT in httpOnly cookies
- Real Circle W3S wallet provisioning via `createUserPinWithWallets`
- Arc testnet integration (USDC balance + tx receipts via viem)
- x402 EIP-712 sign + Circle Gateway facilitator (`POST /v1/x402/settle`)
- Multi-artist marketplace (browse, profile, dashboard, upload)
- Sticky audio player with pay-per-play flow
- Spotify-style dark mode UI
- Listening-now real-time stats
- Wallet pill in navbar with USDC balance + address
- Custom domain: `pazzera.com` (frontend) + `api.pazzera.com` (backend)
- Railway backend + Cloudflare Pages frontend