import React, { useEffect, useRef } from 'react';
import symbolMap from '../../../utils/symbolMap.json';

// The five reels of a video slot as real 3D drums (Three.js). Loaded only when a slot is opened (React.lazy in
// SlotGames, and `three` itself is a dynamic import inside this file), so nothing else in the site pays for it.
// The server decides every result; this only animates it. All motion lives in the render loop (refs, no React
// state), and the loop sleeps when nothing moves. Everything it creates is disposed on unmount.
interface Props {
  grid: string[][];              // grid[reel][row] = the symbol (emoji key), row 0 = top
  spinning: boolean[];           // per reel
  lit: Set<string>;              // "reel-row" cells that are part of a win
  pool: string[];                // symbols drawn on the faces that are not the result
  colors: [string, string];      // the game's palette
  onFail?: () => void;           // WebGL not available -> the parent falls back to the CSS reels
}

const FACES = 10;
const STEP = (Math.PI * 2) / FACES;
const OMEGA = 16;                // rad/s at full speed
const SPIN_UP = 0.28;            // s to reach full speed
const MAP = { ...(symbolMap as Record<string, string>), '7️⃣': 'seven' } as Record<string, string>;
const prefersReduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

type Reel = { group: any; faces: any[]; glows: any[]; theta: number; omega: number; mode: 'idle' | 'up' | 'spin' | 'stop'; t: number; from: number; to: number; dur: number; settle: number };

const Reels3D: React.FC<Props> = ({ grid, spinning, lit, pool, colors, onFail }) => {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef({ grid, spinning, lit, pool });
  live.current = { grid, spinning, lit, pool };
  const wake = useRef<() => void>(() => {});
  useEffect(() => { wake.current(); });

  useEffect(() => {
    const el = host.current;
    if (!el) return undefined;
    let dead = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      const THREE = await import('three');
      const { RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js');
      if (dead) return;
      let renderer: any;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'default' });
      } catch { onFail?.(); return; }
      if (!renderer.getContext()) { onFail?.(); return; }
      const reduced = prefersReduced();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:manipulation';
      el.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
      scene.environment = envRT.texture;
      const tint = new THREE.Color(colors[0]);
      scene.add(new THREE.AmbientLight(0xffffff, 0.45));
      const key = new THREE.DirectionalLight(0xfff0d0, 2.2); key.position.set(2, 5, 8); scene.add(key);
      const rim = new THREE.PointLight(tint, 40, 20); rim.position.set(0, 4, -3); scene.add(rim);

      const N = Math.max(3, Math.min(7, live.current.grid.length || 5));   // reels of this game
      const R = 1 / (2 * Math.tan(Math.PI / FACES));      // drum radius for 1-unit faces
      const SPACING = 1.1;
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
      const base = { x: 0, y: 0.15 };
      const par = { tx: 0, ty: 0, x: 0, y: 0 };

      // ---- textures: one per symbol (card background + the Twemoji picture), shared by all faces
      const maxAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      const texCache = new Map<string, any>();
      const bg0 = new THREE.Color(colors[0]).multiplyScalar(0.35).getStyle();
      const bg1 = new THREE.Color(colors[1]).multiplyScalar(0.18).getStyle();
      const texFor = (sym: string) => {
        const hit = texCache.get(sym); if (hit) return hit;
        const c = document.createElement('canvas'); c.width = 256; c.height = 256;
        const ctx = c.getContext('2d')!;
        const paint = (img?: HTMLImageElement) => {
          const g = ctx.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, bg0); g.addColorStop(1, bg1);
          ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
          ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 6; ctx.strokeRect(5, 5, 246, 246);
          if (img) ctx.drawImage(img, 36, 36, 184, 184);
          else { ctx.font = '150px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(sym, 128, 140); }
        };
        paint();
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = maxAniso;
        texCache.set(sym, tex);
        const file = MAP[sym];
        if (file) {
          const img = new Image();
          img.onload = () => { if (dead) return; paint(img); tex.needsUpdate = true; wake.current(); };
          img.src = `/symbols/${file}.svg`;
        }
        return tex;
      };
      // soft round glow for winning cells (additive)
      const glowTex = (() => {
        const c = document.createElement('canvas'); c.width = 128; c.height = 128;
        const x = c.getContext('2d')!; const g = x.createRadialGradient(64, 64, 6, 64, 64, 64);
        g.addColorStop(0, 'rgba(255,230,140,0.95)'); g.addColorStop(0.5, 'rgba(255,190,60,0.35)'); g.addColorStop(1, 'rgba(255,160,0,0)');
        x.fillStyle = g; x.fillRect(0, 0, 128, 128);
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
      })();
      const faceGeo = new THREE.PlaneGeometry(1, 1);
      const glowGeo = new THREE.PlaneGeometry(1.5, 1.5);
      const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
      const metal = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.28, envMapIntensity: 1.2 });
      const mats: any[] = [];
      const randSym = () => live.current.pool[Math.floor(Math.random() * live.current.pool.length)];

      // ---- reels
      const reels: Reel[] = [];
      for (let r = 0; r < N; r += 1) {
        const group = new THREE.Group(); group.position.x = (r - (N - 1) / 2) * SPACING; scene.add(group);
        const faces: any[] = []; const glows: any[] = [];
        for (let i = 0; i < FACES; i += 1) {
          const a = i * STEP;
          const m = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.15, envMapIntensity: 0.3, emissive: 0xffffff, emissiveIntensity: 0, side: THREE.FrontSide });
          mats.push(m);
          const mesh = new THREE.Mesh(faceGeo, m);
          mesh.position.set(0, Math.sin(a) * R, Math.cos(a) * R); mesh.rotation.x = -a;
          const gl = new THREE.Mesh(glowGeo, glowMat.clone()); gl.position.z = 0.02; (gl.material as any).opacity = 0; mats.push(gl.material);
          mesh.add(gl); group.add(mesh); faces.push(mesh); glows.push(gl);
        }
        reels.push({ group, faces, glows, theta: 0, omega: 0, mode: 'idle', t: 0, from: 0, to: 0, dur: 0, settle: 0 });
      }
      // brass dividers between the reels and bars above and below the window
      const barGeo = new THREE.BoxGeometry(0.06, 3.6, 0.5);
      for (let i = 0; i <= N; i += 1) { const b = new THREE.Mesh(barGeo, metal); b.position.set((i - N / 2) * SPACING, 0, R + 0.02); scene.add(b); }
      const capGeo = new THREE.BoxGeometry(N * SPACING + 0.2, 0.35, 0.7);
      const capTop = new THREE.Mesh(capGeo, metal); capTop.position.set(0, 1.78, R + 0.1); scene.add(capTop);
      const capBot = new THREE.Mesh(capGeo, metal); capBot.position.set(0, -1.78, R + 0.1); scene.add(capBot);

      const setFace = (reel: Reel, i: number, sym: string) => {
        const t = texFor(sym); const m = reel.faces[i].material; if (m.map === t) return; const had = !!m.map; m.map = t; m.emissiveMap = t; if (!had) m.needsUpdate = true;
      };
      const rowFaces = [1, 0, FACES - 1]; // top, middle, bottom row of the window
      const showResult = (r: number) => rowFaces.forEach((f, row) => { const s = live.current.grid[r]?.[row]; if (s) setFace(reels[r], f, s); });
      const fillRandom = (r: number) => { for (let i = 0; i < FACES; i += 1) setFace(reels[r], i, randSym()); };
      for (let r = 0; r < N; r += 1) { fillRandom(r); showResult(r); }

      // ---- sizing
      const resize = () => {
        const w = el.clientWidth || 600; const h = el.clientHeight || 340;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        const need = N * SPACING + 0.5;                              // the width that must fit
        const dist = Math.max(3.6 / (2 * Math.tan((camera.fov * Math.PI) / 360)), need / (2 * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect));
        camera.position.set(base.x + par.x, base.y + par.y, R + dist);
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
        wake.current();
      };
      const ro = new ResizeObserver(resize); ro.observe(el); resize();
      const onMove = (e: PointerEvent) => {
        if (reduced) return;
        const b = el.getBoundingClientRect();
        par.tx = ((e.clientX - b.left) / b.width - 0.5) * 0.7; par.ty = -((e.clientY - b.top) / b.height - 0.5) * 0.4; wake.current();
      };
      window.addEventListener('pointermove', onMove, { passive: true });

      // ---- loop (sleeps when nothing moves)
      let raf = 0; let last = 0; let running = false; let time = 0;
      const prevSpin = reels.map(() => false);
      const tick = (now: number) => {
        raf = 0; running = false;
        const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now; time += dt;
        let busy = false;
        const { spinning: sp, lit: litSet } = live.current;
        for (let r = 0; r < N; r += 1) {
          const rl = reels[r];
          const want = !!sp[r];
          if (want && !prevSpin[r]) { fillRandom(r); rl.mode = 'up'; rl.t = 0; rl.omega = 0; }
          if (!want && prevSpin[r] && (rl.mode === 'up' || rl.mode === 'spin')) {
            showResult(r);
            const w = Math.max(rl.omega, OMEGA * 0.6);
            const minD = 0.25 * w; const rest = ((rl.theta + minD) % (Math.PI * 2));
            rl.from = rl.theta; rl.to = rl.theta + minD + (rest === 0 ? 0 : Math.PI * 2 - rest);
            const D = rl.to - rl.from; rl.dur = reduced ? 0.35 : (2 * D) / w; rl.t = 0; rl.mode = 'stop'; rl.settle = 0;
          }
          if (!want && !prevSpin[r] && rl.mode === 'idle') { /* new grid while idle (first paint) */ showResult(r); }
          prevSpin[r] = want;
          if (rl.mode === 'up') { rl.t += dt; rl.omega = OMEGA * Math.min(1, rl.t / SPIN_UP); rl.theta += rl.omega * dt; if (rl.t >= SPIN_UP) rl.mode = 'spin'; busy = true; }
          else if (rl.mode === 'spin') { rl.omega = OMEGA; rl.theta += rl.omega * dt; busy = true; }
          else if (rl.mode === 'stop') {
            rl.t += dt; const k = Math.min(1, rl.t / rl.dur); const e = 1 - (1 - k) * (1 - k);
            let th = rl.from + (rl.to - rl.from) * e;
            if (k >= 1) { rl.settle += dt; if (!reduced) th = rl.to - 0.07 * Math.sin(rl.settle * 22) * Math.exp(-rl.settle * 9); if (rl.settle > 0.5) { th = rl.to; rl.mode = 'idle'; rl.theta = 0; } }
            rl.omega = k < 1 ? (OMEGA * (1 - k)) : 0; rl.theta = rl.mode === 'idle' ? 0 : th; busy = true;
          }
          rl.group.rotation.x = rl.mode === 'idle' ? 0 : rl.theta;
          // faux motion blur: stretch and soften the faces while they fly
          const blur = Math.min(1, rl.omega / OMEGA);
          for (let i = 0; i < FACES; i += 1) {
            const f = rl.faces[i]; const m = f.material;
            const row = i === 1 ? 0 : i === 0 ? 1 : i === FACES - 1 ? 2 : -1;
            const isLit = rl.mode === 'idle' && row >= 0 && litSet.has(`${r}-${row}`);
            const anyLit = litSet.size > 0 && rl.mode === 'idle';
            const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(time * 6);
            f.scale.set(1 - 0.04 * blur + (isLit && !reduced ? 0.07 * pulse : 0), 1 + 0.1 * blur + (isLit && !reduced ? 0.07 * pulse : 0), 1);
            m.opacity = 1; m.transparent = false;
            m.emissiveIntensity = isLit ? 0.22 + 0.2 * pulse : 0.04 * blur;
            const dim = anyLit && !isLit ? 0.5 : 1; m.color.setScalar(dim);
            const g = rl.glows[i].material; g.opacity = isLit ? 0.22 + 0.2 * pulse : 0;
          }
          if (litSet.size > 0 && rl.mode === 'idle' && !reduced) busy = true;
        }
        par.x += (par.tx - par.x) * Math.min(1, dt * 4); par.y += (par.ty - par.y) * Math.min(1, dt * 4);
        if (Math.abs(par.tx - par.x) > 0.002 || Math.abs(par.ty - par.y) > 0.002) busy = true;
        camera.position.set(base.x + par.x, base.y + par.y, camera.position.z); camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
        if (busy && !document.hidden) { running = true; raf = requestAnimationFrame(tick); } else last = 0;
      };
      const start = () => { if (!running && !dead && !document.hidden) { running = true; raf = requestAnimationFrame(tick); } };
      wake.current = start;
      const onVis = () => { if (!document.hidden) { last = 0; start(); } };
      document.addEventListener('visibilitychange', onVis);
      start();

      cleanup = () => {
        wake.current = () => {};
        if (raf) cancelAnimationFrame(raf);
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('pointermove', onMove);
        ro.disconnect();
        texCache.forEach((t) => t.dispose()); glowTex.dispose();
        mats.forEach((m) => m.dispose()); metal.dispose(); glowMat.dispose();
        faceGeo.dispose(); glowGeo.dispose(); barGeo.dispose(); capGeo.dispose();
        envRT.dispose(); pmrem.dispose();
        renderer.dispose(); renderer.forceContextLoss?.();
        if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
      };
      if (dead) cleanup();
    })();

    return () => { dead = true; if (cleanup) cleanup(); };
    // The scene is built once per mount; props reach the loop through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const n = Math.max(3, Math.min(7, grid.length || 5));
  return <div ref={host} className="w-full mx-auto" style={{ aspectRatio: `${n * 1.1 + 0.5} / 3.6`, maxWidth: n >= 5 ? undefined : `${n * 160 + 80}px` }} aria-hidden="true" />;
};

export default Reels3D;
