// Keno: 40 numbers, the house draws 10, the player picked 1-8. Payout by number of hits is built from the exact
// hypergeometric odds so that every pick count returns about KENO_RTP of the stakes in the long run.
export const KENO_POOL = 40;
export const KENO_DRAWN = 10;
export const KENO_MAX_PICKS = 8;
export const KENO_RTP = 0.94;

const choose = (n, k) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i += 1) r = (r * (n - k + i)) / i; return r; };
export const hitProbability = (picks, hits) => (choose(KENO_DRAWN, hits) * choose(KENO_POOL - KENO_DRAWN, picks - hits)) / choose(KENO_POOL, picks);

// weights of the RTP share per number of hits: the more hits, the bigger the share (it is rare, so the pay is huge)
const shares = (picks) => {
  const min = Math.max(1, Math.ceil(picks / 2) - (picks >= 5 ? 1 : 0));
  const hits = []; for (let h = min; h <= picks; h += 1) hits.push(h);
  const w = hits.map((_, i) => 1 + i * 0.8); const total = w.reduce((a, b) => a + b, 0);
  return hits.map((h, i) => ({ hits: h, share: w[i] / total }));
};
export const KENO_MAX_MULTIPLIER = 1000; // no pay above 1000x the stake; the RTP freed by the cap goes to the lower hits
const buildPaytable = (picks) => {
  const rows = shares(picks).map(({ hits, share }) => ({ hits, p: hitProbability(picks, hits), pay: (KENO_RTP * share) / hitProbability(picks, hits) }));
  for (let pass = 0; pass < 6; pass += 1) {
    const capped = rows.filter((r) => r.pay > KENO_MAX_MULTIPLIER);
    if (capped.length === 0) break;
    capped.forEach((r) => { r.pay = KENO_MAX_MULTIPLIER; });
    const fixed = rows.filter((r) => r.pay >= KENO_MAX_MULTIPLIER);
    const free = rows.filter((r) => r.pay < KENO_MAX_MULTIPLIER);
    const left = KENO_RTP - fixed.reduce((a, r) => a + r.pay * r.p, 0);
    const have = free.reduce((a, r) => a + r.pay * r.p, 0);
    if (free.length === 0 || have <= 0) break;
    free.forEach((r) => { r.pay *= left / have; });
  }
  return Object.fromEntries(rows.map((r) => [r.hits, Math.round(r.pay * 100) / 100]));
};
export const KENO_PAYTABLE = Object.fromEntries(Array.from({ length: KENO_MAX_PICKS }, (_, i) => i + 1).map((picks) => [picks, buildPaytable(picks)]));
export const kenoRtp = (picks) => Object.entries(KENO_PAYTABLE[picks]).reduce((a, [h, m]) => a + m * hitProbability(picks, Number(h)), 0);

// `rng(n)` -> integer in [0, n). Returns 10 distinct numbers 1..40.
export function drawKeno(rng) {
  const pool = Array.from({ length: KENO_POOL }, (_, i) => i + 1);
  for (let i = 0; i < KENO_DRAWN; i += 1) { const j = i + rng(KENO_POOL - i); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, KENO_DRAWN);
}
export const kenoResult = (picks, drawn) => {
  const hits = picks.filter((n) => drawn.includes(n)).length;
  return { hits, multiplier: KENO_PAYTABLE[picks.length][hits] || 0 };
};
