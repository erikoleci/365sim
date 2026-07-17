import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import authRouter from './routes/auth.js';
import matchesRouter from './routes/matches.js';
import betsRouter from './routes/bets.js';
import adminRouter from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, '..', 'dist');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(
  helmet({
    // Allow the SPA's own inline/loaded assets when served from this same process.
    contentSecurityPolicy: false,
  })
);
app.use(cors());
app.use(express.json());

// Brute-force protection on auth endpoints: 20 attempts / 15 min per IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Shumë përpjekje. Provo përsëri pas disa minutash.' },
});

app.use('/api/auth', authLimiter, authRouter);
app.use('/api/matches', matchesRouter);
app.use('/api/bets', betsRouter);
app.use('/api/admin', adminRouter);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Serve the built frontend (npm run build -> dist/) from the same origin/process
// as the API. This avoids CORS and cross-domain /api URL issues in production.
// If dist/ doesn't exist (e.g. pure API-only deploy), this is skipped silently.
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/^(?!\/api\/).*/, (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  console.warn('WARNING: dist/ not found — run "npm run build" to serve the frontend from this server.');
}

app.listen(PORT, () => {
  console.log(`365sim backend listening on http://localhost:${PORT}`);
  if (!process.env.ODDS_API_KEY) {
    console.warn('WARNING: ODDS_API_KEY is not set — /api/matches will return an empty list until you add one in .env');
  }
});
