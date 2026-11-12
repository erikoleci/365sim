import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { serviceBase, __resetProcForTests } from '../server/flashscoreProc.js';

const fakeChild = () => { const c = new EventEmitter(); c.stderr = new EventEmitter(); c.unref = () => {}; c.kill = () => {}; return c; };
beforeEach(() => { __resetProcForTests(); delete process.env.FLASHSCORE_URL; delete process.env.FLASHSCORE; });

describe('bundled Flashscore scraper process', () => {
  it('starts lazily on 127.0.0.1 only, once, with no URL to configure', () => {
    const calls = [];
    const spawnImpl = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return fakeChild(); };
    const a = serviceBase({ spawnImpl, exists: () => true });
    const b = serviceBase({ spawnImpl, exists: () => true });
    expect(a).toBe('http://127.0.0.1:8765'); expect(b).toBe(a);
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.env.HOST).toBe('127.0.0.1');
    expect(calls[0].args).toEqual(['run.py']);
  });
  it('an external FLASHSCORE_URL wins and nothing is started', () => {
    process.env.FLASHSCORE_URL = 'http://fs:8000/';
    let started = 0;
    expect(serviceBase({ spawnImpl: () => { started++; return fakeChild(); }, exists: () => true })).toBe('http://fs:8000');
    expect(started).toBe(0);
  });
  it('FLASHSCORE=0 turns it off; no Python means idle, not a crash', () => {
    process.env.FLASHSCORE = '0';
    expect(serviceBase({ spawnImpl: () => fakeChild(), exists: () => true })).toBeNull();
    delete process.env.FLASHSCORE;
    expect(serviceBase({ spawnImpl: () => fakeChild(), exists: () => false })).toBeNull();
  });
  it('a crashed scraper is restarted later with a growing pause, not in a tight loop', () => {
    let n = 0; let last;
    const spawnImpl = () => { n++; last = fakeChild(); return last; };
    serviceBase({ now: 1000, spawnImpl, exists: () => true });
    last.emit('exit', 1);
    serviceBase({ now: Date.now(), spawnImpl, exists: () => true }); // immediately: still waiting
    expect(n).toBe(1);
  });
});
