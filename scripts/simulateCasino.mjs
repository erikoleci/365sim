// Statistical check of every 'outcome' game: plays N rounds through the same pipeline the server uses and compares the
// measured hit frequency and RTP with the profile, and with what the Admin Panel shows (previewOutcome).
// Usage: node scripts/simulateCasino.mjs [rounds] [hit%] [rtp%] [volatility 1-5]
import { outcomeGames, simulateProfile } from '../server/casinoOutcomeGames.js';
import { drawProfiled, outcomeScale, previewOutcome } from '../server/casinoProfiles.js';
import { mulberry32 } from '../server/raceOdds.js';
import calibration from '../server/casinoCalibration.json' with { type: 'json' };

const rounds = Number(process.argv[2]) || 500000;
const hit = (Number(process.argv[3]) || 15) / 100; const rtp = (Number(process.argv[4]) || 30) / 100;
const volatility = Number(process.argv[5]) || 5;
const profile = { hitFrequency: hit, rtp, volatility, minBet: 1, maxBet: 5000, maxWinMultiplier: 2000 };
const r1 = mulberry32(777); const r2 = mulberry32(999);
const rng = (n) => Math.floor(r1() * n); const randFloat = () => r2();
const games = outcomeGames(rng);
console.log(`profile: hit ${(hit * 100).toFixed(1)}%  rtp ${(rtp * 100).toFixed(1)}%  volatility ${volatility}  rounds ${rounds}`);
console.log('game | hit% (target) | RTP% (target) | net-win% (admin) | sd (admin) | biggest win x (admin)');
let worstHit = 0; let worstRtp = 0; let worstSd = 0; let worstZ = 0; let worstZKey = '';
for (const [key, game] of Object.entries(games)) {
  const s = simulateProfile({ profile, cal: calibration[key], game, rounds, rng, randFloat, drawProfiled, outcomeScale });
  const pv = previewOutcome(profile, calibration[key]);
  worstSd = Math.max(worstSd, Math.abs(s.sd - pv.volatilitySd) / pv.volatilitySd);
  const z = Math.abs(s.rtp - rtp) / (s.sd / Math.sqrt(rounds)); if (z > worstZ) { worstZ = z; worstZKey = key; }
  worstHit = Math.max(worstHit, Math.abs(s.hit - hit)); worstRtp = Math.max(worstRtp, Math.abs(s.rtp - rtp));
  console.log(`${key} | ${(s.hit * 100).toFixed(2)} (${(hit * 100).toFixed(1)}) | ${(s.rtp * 100).toFixed(2)} (${(rtp * 100).toFixed(1)}) | ${(s.netHit * 100).toFixed(2)} (${(pv.netWinFrequency * 100).toFixed(2)}) | ${s.sd.toFixed(2)} (${pv.volatilitySd.toFixed(2)}) | ${s.max.toFixed(1)} (${pv.maxPayout.toFixed(1)})`);
}
console.log(`worst deviation: hit ${(worstHit * 100).toFixed(2)} points, RTP ${(worstRtp * 100).toFixed(2)} points, sd ${(worstSd * 100).toFixed(1)}% vs the Admin preview; largest RTP z-score ${worstZ.toFixed(2)} (${worstZKey}, ${rounds} rounds; |z| < 3.5 is sampling noise)`);
