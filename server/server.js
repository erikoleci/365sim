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
// Render (and most PaaS hosts) sit behind a reverse proxy that sets
// X-Forwarded-For. Without this, express-rate-limit throws
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR because it can't safely trust that
// header. `1` = trust exactly one hop (Render's own proxy), not arbitrary
// client-supplied headers.
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;

app.use(helmet());
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
  const indexHtmlPath = path.join(distPath, 'index.html');
  console.log(`[static] Serving frontend from ${distPath} (index.html present: ${fs.existsSync(indexHtmlPath)})`);
  app.use(express.static(distPath));
  app.get(/^(?!\/api\/).*/, (req, res) => {
    if (!fs.existsSync(indexHtmlPath)) {
      console.error(`[static] index.html missing at ${indexHtmlPath} — did "npm run build" actually run?`);
      return res.status(500).send('Frontend build not found on server (dist/index.html missing). Check build logs.');
    }
    res.sendFile(indexHtmlPath);
  });
} else {
  console.error(`[static] dist/ not found at ${distPath} — run "npm run build" before starting the server, or check your Build Command.`);
}

app.listen(PORT, () => {
  console.log(`365sim backend listening on http://localhost:${PORT}`);
  if (!process.env.API_FOOTBALL_KEY) {
    console.warn('WARNING: API_FOOTBALL_KEY is not set — /api/matches will return an empty list until you add one in .env');
  }
  if (!process.env.JWT_SECRET) {
    console.error(
      'SECURITY WARNING: JWT_SECRET is not set. Using an insecure hardcoded fallback ' +
      'means ANYONE can forge a valid admin login token. Set JWT_SECRET in your ' +
      'environment (Render: Environment tab -> Generate) before letting real users in.'
    );
  }
});
