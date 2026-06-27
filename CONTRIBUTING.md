# Contributing to Pazzera

Thanks for your interest in Pazzera. This is an indie hackathon project — contributions are welcome but lightweight on process.

## Quick rules

1. **Open an issue first** for non-trivial changes (features, refactors, schema changes). Bug fixes can go straight to PR.
2. **Branch from `main`**, name your branch `fix/...` or `feat/...`.
3. **Tests required** for backend changes (vitest). Frontend changes should be smoke-tested in browser.
4. **Keep PRs focused** — one feature or fix per PR, not five.
5. **Squash commits** before merging.

## Setup

```bash
git clone https://github.com/ruzkypazzy/pazzera.git
cd pazzera
cd server && npm install && npm run build
cd ../web && npm install && npm run build
```

See [README.md](./README.md) for full env var setup.

## Code style

- **TypeScript strict mode** — no `any`, no `// @ts-ignore` without comment
- **No external state libraries** — the frontend uses plain JS with a tiny router
- **Backend**: Express + better-sqlite3 / pg. Async/await throughout.
- **Frontend**: Vanilla JS modules + Vite. No React/Vue unless we explicitly add it.
- **Commit messages**: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:` prefix.

## Project structure

```
pazzera/
├── server/         # Express + TypeScript API
│   ├── src/
│   │   ├── db.ts          # SQLite schema + helpers
│   │   ├── index.ts       # Express app + middleware
│   │   ├── routes/        # HTTP endpoints (one file per resource)
│   │   └── services/      # Business logic (auth, circle, email, etc.)
│   ├── tests/             # vitest
│   └── scripts/seed.ts     # (optional) demo data seeder
├── web/            # Vite + vanilla JS SPA
│   ├── src/
│   │   ├── main.js         # Router, state, API client, all pages
│   │   └── styles.css      # Dark-mode theme
│   └── public/             # Static assets (logo, favicon)
├── ARCHITECTURE.md
├── SECURITY.md
└── README.md
```

## Adding a new endpoint

1. Add route handler in the appropriate `server/src/routes/<resource>.ts`
2. Validate input with zod
3. Call `getDb()` for queries
4. Use `audit(req, '...', { ... })` for security-sensitive actions
5. Add a test in `server/tests/<resource>.test.ts`
6. Update the API Reference in README.md

## Adding a new page

1. Add `router.on('/path', handler)` in `web/src/main.js`
2. Use `html\`...\`` template literals (not framework JSX)
3. Reuse helpers: `trackRow()`, `emptyState()`, `avatarHtml()`, `formatUsdc()`
4. Mobile-responsive: use the existing breakpoint styles

## Testing

```bash
cd server
npm test              # runs all vitest suites
npm run test:watch    # watch mode for dev
npm run typecheck     # tsc --noEmit
```

Frontend doesn't have formal tests yet — verify changes in browser before submitting PR.

## Database changes

1. Update `server/src/db.ts` schema in `runSchema()`
2. Use `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` (idempotent)
3. If changing existing tables, add a migration comment in the schema SQL
4. For breaking changes, write a migration script in `server/scripts/migrate-NNN-name.ts`

## Security

- Never log passwords, JWT secrets, or Circle API keys
- Use `audit(req, 'action', { userId, metadata })` for security-sensitive operations
- Validate every input with zod
- Use `rateLimit()` middleware on new auth-related endpoints
- See [SECURITY.md](./SECURITY.md) for the full model

## Pull request process

1. Update tests + docs as needed
2. Verify `npm run build` succeeds on both server and web
3. Run `npm test` and `npm run typecheck`
4. Open PR with a clear description (what changed, why, how to test)
5. Wait for review — I'll try to turn around PRs within a few days

## Community

- Telegram: [@OnisowoBot](https://t.me/OnisowoBot) (yes, the name carried over from an earlier project — Pazzera and Onisowo share the same developer)
- GitHub Issues for bugs and feature requests
- Email for security: security@pazzera.com

## Code of conduct

Be kind. Don't be a jerk. We're building a music platform, not fighting a war.
