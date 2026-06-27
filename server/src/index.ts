import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { initDb } from './db.js';
import { tracksRouter } from './routes/tracks.js';
import { artistsRouter } from './routes/artists.js';
import { playRouter } from './routes/play.js';
import { authRouter } from './routes/auth.js';
import { accountRouter } from './routes/account.js';
import { passwordResetRouter } from './routes/password-reset.js';
import { dashboardRouter } from './routes/dashboard.js';
import { statsRouter } from './routes/stats.js';
import { adminRouter } from './routes/admin.js';
import { agentRouter } from './routes/agent.js';
import { curatorRouter } from './routes/curator.js';
import { faucetRouter } from './routes/faucet.js';
import { debugRouter } from './routes/debug.js';
import { emailAuthRouter } from './routes/email-auth.js';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173';

// Parse allowed origins from env, or default to permissive list
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'https://pazzera.com,https://www.pazzera.com,http://localhost:5173,http://localhost:3001')
  .split(',').map(s => s.trim()).filter(Boolean);

// Security headers — relax CSP for API (frontend serves from Cloudflare Pages)
app.use(helmet({
  contentSecurityPolicy: false,   // API only; no scripts
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'no-referrer' },
}));

app.set('trust proxy', 1);  // honor X-Forwarded-For from Cloudflare/Railway

// CORS — strict allowlist (was allow-any; now locked to known origins)
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);  // mobile apps / curl with no origin
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    console.warn('[cors] blocked origin:', origin);
    return cb(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['content-type', 'authorization', 'x-requested-with'],
  maxAge: 86400,
}));

// Body limits — small for JSON, larger for avatar uploads
app.use(express.json({ limit: '1mb' }));
app.use('/api/account/avatar', express.json({ limit: '8mb' }));
app.use(cookieParser());

// Static uploads (avatars, track covers) — served with cache headers
import { existsSync } from 'node:fs';
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? './uploads';
if (existsSync(UPLOADS_DIR)) {
  app.use('/uploads', express.static(UPLOADS_DIR, {
    maxAge: '7d',
    immutable: true,
    setHeaders: (res) => res.setHeader('Access-Control-Allow-Origin', '*'),
  }));
}

// Health
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'pazzera', ts: Date.now(), version: '0.2.0' });
});

// Readiness — checks DB
app.get('/ready', (_req, res) => {
  try {
    initDb();
    res.json({ ok: true });
  } catch (e: any) {
    res.status(503).json({ ok: false, error: e?.message ?? 'db unavailable' });
  }
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api/auth', passwordResetRouter);
app.use('/api/email-auth', emailAuthRouter);
app.use('/api/account', accountRouter);
app.use('/api/tracks', tracksRouter);
app.use('/api/artists', artistsRouter);
app.use('/api/play', playRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/stats', statsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/agent', agentRouter);
app.use('/api/curator', curatorRouter);
app.use('/api/faucet', faucetRouter);
app.use('/api/debug', debugRouter);

// 404 + error handlers — never leak stack traces to client
app.use((req, res) => {
  res.status(404).json({ error: 'not found', path: req.path });
});

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('[error]', err);
  res.status(err.status ?? 500).json({
    error: err.message ?? 'internal error',
    ...(process.env.NODE_ENV !== 'production' ? { stack: err.stack } : {}),
  });
});

// Boot
initDb();
app.listen(PORT, () => {
  console.log(`[pazzera] listening on http://localhost:${PORT}`);
  console.log(`[pazzera] CORS origins: ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`[pazzera] PUBLIC_BASE_URL: ${PUBLIC_BASE_URL}`);
});