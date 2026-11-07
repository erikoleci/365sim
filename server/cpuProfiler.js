// On-demand CPU profile of the running server, for finding what keeps the processor busy. Nothing runs until it is asked:
//   docker kill -s USR2 sim365-app-1        (starts a 30 s profile; node is PID 1 in the container)
//   docker logs --tail 60 sim365-app-1      (30 s later: the busiest functions and files)
// Costs a few percent of CPU while it records, and nothing otherwise.
import inspector from 'node:inspector';

// Pure: turn a V8 CPU profile into the busiest functions / files. Time is attributed to the node a sample landed in.
export function summarizeProfile(profile, top = 20) {
  const byNode = new Map(profile.nodes.map((n) => [n.id, n]));
  const fn = new Map();
  const file = new Map();
  let busy = 0;
  let idle = 0;
  const samples = profile.samples || [];
  const deltas = profile.timeDeltas || [];
  for (let i = 0; i < samples.length; i++) {
    const node = byNode.get(samples[i]);
    const us = Number(deltas[i]) || 0;
    if (!node) continue;
    const cf = node.callFrame || {};
    if (cf.functionName === '(idle)') { idle += us; continue; }
    busy += us;
    const where = (cf.url || '').replace(/^file:\/\//, '').replace(/^.*\/app\//, '') + ':' + ((cf.lineNumber ?? 0) + 1);
    const name = (cf.functionName || '(anonymous)') + ' ' + where;
    fn.set(name, (fn.get(name) || 0) + us);
    const f = (cf.url || cf.functionName || '?').replace(/^file:\/\//, '').replace(/^.*\/app\//, '');
    file.set(f, (file.get(f) || 0) + us);
  }
  const rank = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)
    .map(([name, us]) => ({ name, ms: Math.round(us / 1000), pct: busy ? Math.round((us / busy) * 1000) / 10 : 0 }));
  return { busyMs: Math.round(busy / 1000), idleMs: Math.round(idle / 1000), functions: rank(fn), files: rank(file) };
}

let running = false;
export function profileCpu(seconds = 30) {
  if (running) return Promise.resolve(null);
  running = true;
  const session = new inspector.Session();
  session.connect();
  const post = (m, p) => new Promise((resolve, reject) => session.post(m, p || {}, (err, res) => (err ? reject(err) : resolve(res))));
  return (async () => {
    try {
      await post('Profiler.enable');
      await post('Profiler.start');
      await new Promise((r) => setTimeout(r, seconds * 1000));
      const { profile } = await post('Profiler.stop');
      return summarizeProfile(profile);
    } finally {
      try { session.disconnect(); } catch { /* already closed */ }
      running = false;
    }
  })();
}

export function installCpuProfileSignal() {
  const seconds = Math.min(120, Math.max(5, Number(process.env.CPU_PROFILE_SECONDS) || 30));
  process.on('SIGUSR2', () => {
    console.log(`[cpu-profile] recording ${seconds}s ...`);
    profileCpu(seconds).then((s) => {
      if (!s) return console.log('[cpu-profile] already recording');
      const total = s.busyMs + s.idleMs;
      console.log(`[cpu-profile] ${seconds}s done: busy ${s.busyMs}ms of ${total}ms (${total ? Math.round((s.busyMs / total) * 100) : 0}%)`);
      console.log('[cpu-profile] TOP FILES:\n' + s.files.slice(0, 10).map((x) => `  ${String(x.pct).padStart(5)}%  ${x.ms}ms  ${x.name}`).join('\n'));
      console.log('[cpu-profile] TOP FUNCTIONS:\n' + s.functions.slice(0, 15).map((x) => `  ${String(x.pct).padStart(5)}%  ${x.ms}ms  ${x.name}`).join('\n'));
    }).catch((err) => console.error('[cpu-profile] failed:', err.message));
  });
}
