// Race-day atmosphere made with the Web Audio API (no audio files): crowd bed that swells with the race, a gate bell,
// galloping hoofbeats and a finish horn. Follows the same on/off switch as the other casino sounds.
import { soundOn } from './slotSound';

let ctx: AudioContext | null = null;
let crowd: { src: AudioBufferSourceNode; gain: GainNode; filt: BiquadFilterNode } | null = null;
let gallop: number | null = null;
const ac = () => { if (!ctx) { const C = (window as any).AudioContext || (window as any).webkitAudioContext; if (C) ctx = new C(); } if (ctx && ctx.state === 'suspended') void ctx.resume(); return ctx; };

function noiseBuffer(c: AudioContext) {
  const len = c.sampleRate * 2; const b = c.createBuffer(1, len, c.sampleRate); const d = b.getChannelData(0);
  let last = 0; for (let i = 0; i < len; i += 1) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
  return b;
}
function tone(c: AudioContext, f: number, t: number, dur: number, type: OscillatorType, vol: number, slideTo?: number) {
  const o = c.createOscillator(); const g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.05);
}
function thump(c: AudioContext, t: number, vol: number) {
  const o = c.createOscillator(); const g = c.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.09);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11); o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.14);
}

export const raceSfx = {
  // Crowd murmur; call setCrowd(0..1) to change the excitement.
  startCrowd() {
    if (!soundOn() || crowd) return; const c = ac(); if (!c) return;
    const src = c.createBufferSource(); src.buffer = noiseBuffer(c); src.loop = true;
    const filt = c.createBiquadFilter(); filt.type = 'bandpass'; filt.frequency.value = 520; filt.Q.value = 0.6;
    const gain = c.createGain(); gain.gain.value = 0.0001; src.connect(filt).connect(gain).connect(c.destination); src.start();
    gain.gain.linearRampToValueAtTime(0.05, c.currentTime + 1.2); crowd = { src, gain, filt };
  },
  setCrowd(level: number) {
    if (!crowd || !ctx) return; const t = ctx.currentTime + 0.25;
    crowd.gain.gain.linearRampToValueAtTime(0.04 + level * 0.16, t); crowd.filt.frequency.linearRampToValueAtTime(450 + level * 900, t);
  },
  stopCrowd() {
    if (!crowd || !ctx) { crowd = null; return; } const k = crowd; crowd = null;
    k.gain.gain.cancelScheduledValues(ctx.currentTime); k.gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
    window.setTimeout(() => { try { k.src.stop(); } catch { /* already stopped */ } }, 900);
  },
  // Starting bell + gates clanging open.
  gates() {
    if (!soundOn()) return; const c = ac(); if (!c) return; const t = c.currentTime;
    for (let i = 0; i < 3; i += 1) { tone(c, 1320, t + i * 0.16, 0.5, 'triangle', 0.1); tone(c, 1980, t + i * 0.16, 0.4, 'sine', 0.05); }
    tone(c, 180, t + 0.55, 0.25, 'square', 0.07, 90); tone(c, 140, t + 0.62, 0.3, 'sawtooth', 0.05, 70);
  },
  // Galloping paws: `speed` 0..1 changes the tempo.
  startGallop(getSpeed: () => number) {
    if (!soundOn()) return; this.stopGallop(); const c = ac(); if (!c) return;
    let beat = 0;
    const step = () => {
      const k = ac(); if (!k || !soundOn()) { gallop = null; return; }
      const s = Math.max(0.2, Math.min(1, getSpeed())); const t = k.currentTime;
      thump(k, t, 0.05 + s * 0.04); thump(k, t + 0.07, 0.035 + s * 0.03); if (beat % 2 === 0) thump(k, t + 0.14, 0.03);
      beat += 1; gallop = window.setTimeout(step, 340 - s * 150);
    };
    step();
  },
  stopGallop() { if (gallop !== null) { window.clearTimeout(gallop); gallop = null; } },
  // The crowd roars for the winner, finish horn.
  finish(won: boolean) {
    if (!soundOn()) return; const c = ac(); if (!c) return; const t = c.currentTime;
    tone(c, 392, t, 0.7, 'sawtooth', 0.07); tone(c, 494, t, 0.7, 'sawtooth', 0.05);
    this.setCrowd(1); window.setTimeout(() => this.setCrowd(0.3), 2200);
    if (won) [523, 659, 784, 1047].forEach((f, i) => tone(c, f, t + 0.8 + i * 0.1, 0.22, 'triangle', 0.09));
  },
  stopAll() { this.stopGallop(); this.stopCrowd(); },
};
