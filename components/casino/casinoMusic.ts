// Relaxed lounge music for the casino, synthesised live with the Web Audio API (no audio files, nothing to license).
// A warm pad plays a slow chord loop, with a soft bass and a gentle pluck melody on top. It starts after the first
// tap/click inside the casino (browsers block autoplay) unless the player turned it off; the choice is remembered.
const KEY = 'casinoMusic';
const BPM = 76;
const BEAT = 60 / BPM;
// Am9 - Fmaj7 - Cmaj7 - G6 (MIDI notes), two bars each
const CHORDS: number[][] = [[57, 60, 64, 67, 71], [53, 57, 60, 64, 67], [48, 52, 55, 59, 64], [55, 59, 62, 64, 71]];
const BASS = [45, 41, 36, 43];
const PLUCK = [76, 79, 81, 79, 83, 81, 79, 76];
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let timer: number | null = null;
let nextBar = 0;
let bar = 0;
let running = false;

export const musicPref = () => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } };
export const setMusicPref = (v: boolean) => { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ } };
export const musicRunning = () => running;

function note(c: AudioContext, dest: AudioNode, freq: number, t: number, dur: number, type: OscillatorType, vol: number, attack: number) {
  const o = c.createOscillator(); const g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
}

function scheduleBar(c: AudioContext, t: number) {
  const idx = Math.floor(bar / 2) % CHORDS.length;
  const barLen = BEAT * 4;
  if (bar % 2 === 0) { // pad lasts two bars
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 0.4; lp.connect(master!);
    CHORDS[idx].forEach((m, i) => { note(c, lp, hz(m), t, barLen * 2.1, 'triangle', 0.05, 1.6); note(c, lp, hz(m) * 1.004, t, barLen * 2.1, 'sine', 0.035, 1.8 + i * 0.1); });
    note(c, master!, hz(BASS[idx]), t, barLen * 2, 'sine', 0.16, 0.08);
  }
  // soft pluck melody, 8th notes with rests
  for (let i = 0; i < 8; i += 1) {
    if ((bar + i) % 3 === 2) continue;
    const m = PLUCK[(i + bar * 3) % PLUCK.length] - (idx === 3 ? 2 : 0);
    note(c, master!, hz(m), t + i * (BEAT / 2), 0.9, 'sine', 0.045, 0.01);
  }
  // quiet shaker tick
  for (let i = 0; i < 4; i += 1) note(c, master!, 5200, t + i * BEAT + BEAT / 2, 0.04, 'square', 0.004, 0.002);
  bar += 1;
}

function pump() {
  if (!ctx || !running) return;
  while (nextBar < ctx.currentTime + 1.2) { scheduleBar(ctx, nextBar); nextBar += BEAT * 4; }
}

export function startMusic() {
  if (running) return;
  const C = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!C) return;
  if (!ctx) ctx = new C();
  if (ctx!.state === 'suspended') void ctx!.resume();
  if (!master) { master = ctx!.createGain(); master.connect(ctx!.destination); }
  master.gain.cancelScheduledValues(ctx!.currentTime);
  master.gain.setValueAtTime(master.gain.value, ctx!.currentTime);
  master.gain.linearRampToValueAtTime(0.9, ctx!.currentTime + 2);
  running = true; bar = 0; nextBar = ctx!.currentTime + 0.1;
  pump(); timer = window.setInterval(pump, 400);
}

export function stopMusic() {
  if (!running || !ctx || !master) return;
  running = false;
  if (timer) { window.clearInterval(timer); timer = null; }
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
  master.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 1.2);
}
