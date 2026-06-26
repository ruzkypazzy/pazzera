import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initDb } from './db.js';
import { tracksRouter } from './routes/tracks.js';
import { artistsRouter } from './routes/artists.js';
import { playRouter } from './routes/play.js';
import { walletRouter } from './routes/wallet.js';
import { dashboardRouter } from './routes/dashboard.js';
import { adminRouter } from './routes/admin.js';
import { signRouter } from './routes/sign.js';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

app.use(cors({
  origin: process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

// Health
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'pazzera', ts: Date.now() });
});

// Routes
app.use('/api/tracks', tracksRouter);
app.use('/api/artists', artistsRouter);
app.use('/api/play', playRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/admin', adminRouter);
app.use('/api/play/sign-challenge', signRouter);

// Boot
initDb();
app.listen(PORT, () => {
  console.log(`[pazzera] listening on http://localhost:${PORT}`);
});