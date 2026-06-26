import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { initDb } from './db.js';
import { tracksRouter } from './routes/tracks.js';
import { artistsRouter } from './routes/artists.js';
import { playRouter } from './routes/play.js';
import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { adminRouter } from './routes/admin.js';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173';

app.use(cors({
  origin: (origin, cb) => cb(null, true),  // allow any origin (frontend domains)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['content-type', 'user-token'],
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Health
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'pazzera', ts: Date.now() });
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api/tracks', tracksRouter);
app.use('/api/artists', artistsRouter);
app.use('/api/play', playRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/admin', adminRouter);

// Boot
initDb();
app.listen(PORT, () => {
  console.log(`[pazzera] listening on http://localhost:${PORT}`);
  console.log(`[pazzera] CORS origin: ${PUBLIC_BASE_URL}`);
});