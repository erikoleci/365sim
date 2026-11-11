// The Flashscore scraper (flashscore-service/, Python) started and watched by the app itself: no docker-compose change, no URL to set.
// It listens on 127.0.0.1 only (never reachable from outside the container) and starts LAZILY: only when there is a live/just-ended
// football match to enrich. Off with FLASHSCORE=0. FLASHSCORE_URL (an external service) wins when set.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'flashscore-service');
const PORT = Number(process.env.FLASHSCORE_PORT || 8765);
let child = null; let failures = 0; let nextTryAt = 0;

export const pythonPath = () => process.env.FLASHSCORE_PYTHON || '/opt/fsvenv/bin/python';
export const enabled = () => String(process.env.FLASHSCORE ?? '1') !== '0';

// Base URL of the service, starting the local one when needed; null = no service available (module stays idle).
export function serviceBase({ now = Date.now(), spawnImpl = spawn, exists = fs.existsSync } = {}) {
  if (!enabled()) return null;
  if (process.env.FLASHSCORE_URL) return String(process.env.FLASHSCORE_URL).replace(/\/+$/, '');
  if (!exists(pythonPath()) || !exists(path.join(dir, 'run.py'))) return null; // no Python / no scraper in this environment
  if (!child && now >= nextTryAt) {
    try {
      child = spawnImpl(pythonPath(), ['run.py'], { cwd: dir, env: { PATH: process.env.PATH, PORT: String(PORT), HOST: '127.0.0.1', PYTHONUNBUFFERED: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
      const c = child;
      c.stderr && c.stderr.on('data', (d) => { const t = String(d).trim(); if (t) console.warn('[flashscore-svc] ' + t.slice(0, 300)); });
      c.on('error', (e) => { console.error('[flashscore-svc] cannot start:', e.message); if (child === c) child = null; failures++; nextTryAt = Date.now() + Math.min(3600000, 30000 * 2 ** failures); });
      c.on('exit', (code) => { if (child === c) child = null; failures++; nextTryAt = Date.now() + Math.min(3600000, 30000 * 2 ** failures); console.warn('[flashscore-svc] stopped (' + code + '), retry later'); });
      if (c.unref) c.unref();
      console.log('[flashscore-svc] started on 127.0.0.1:' + PORT);
    } catch (e) { child = null; failures++; nextTryAt = now + 60000; }
  }
  return 'http://127.0.0.1:' + PORT;
}
export const stopService = () => { if (child) { try { child.kill(); } catch { /* gone */ } child = null; } };
process.on('exit', stopService);
export const __resetProcForTests = () => { child = null; failures = 0; nextTryAt = 0; };
