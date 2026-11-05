// Slot sounds made in the browser with the Web Audio API (no audio files, so nothing to license). Off until the
// player taps the speaker; remembered in localStorage.
let ctx: AudioContext | null = null;
let on = (() => { try { return localStorage.getItem('slotSound') === '1'; } catch { return false; } })();
const ac = () => { if (!ctx) { const C = (window as any).AudioContext || (window as any).webkitAudioContext; if (C) ctx = new C(); } if (ctx && ctx.state === 'suspended') void ctx.resume(); return ctx; };
export const soundOn = () => on;
export const setSound = (v: boolean) => { on = v; try { localStorage.setItem('slotSound', v ? '1' : '0'); } catch { /* ignore */ } if (v) tone(660, 0.08, 'square', 0.05); };
function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.08, when = 0, slideTo?: number) {
  if (!on) return; const c = ac(); if (!c) return;
  const t = c.currentTime + when; const o = c.createOscillator(); const g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
}
export const sfx = {
  click: () => tone(520, 0.05, 'square', 0.04),
  spin: () => { for (let i = 0; i < 6; i += 1) tone(300 + i * 40, 0.06, 'triangle', 0.04, i * 0.07); },
  stop: () => { tone(140, 0.12, 'sine', 0.12, 0, 70); tone(900, 0.03, 'square', 0.03); },
  win: (big: boolean) => { const n = big ? [523, 659, 784, 1047, 1319] : [523, 659, 784]; n.forEach((f, i) => tone(f, 0.18, 'triangle', 0.09, i * 0.1)); },
};
