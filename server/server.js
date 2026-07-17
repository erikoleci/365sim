import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import authRouter from './routes/auth.js';
import matchesRouter from './routes/matches.js';
import betsRouter from './routes/bets.js';
import adminRouter from './routes/admin.js';

const app = express();
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

app.listen(PORT, () => {
  console.log(`365sim backend listening on http://localhost:${PORT}`);
  if (!process.env.ODDS_API_KEY) {
    console.warn('WARNING: ODDS_API_KEY is not set — /api/matches will return an empty list until you add one in .env');
  }
});
