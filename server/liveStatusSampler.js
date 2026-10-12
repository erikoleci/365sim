// Evidence collector for the provider's numeric `api_status` (its meaning is NOT documented in
// this repo, so nothing may be guessed from it). Logs the first few (status, minute) samples of
// each distinct status value, once, so a day of logs gives the real mapping:
//   [live-status] api_status=3 first samples: 75:39 (l365-5200421), 12:04 (l365-5200433), ...
// Pure + in-memory; the log line is returned, the caller prints it.
export function createStatusSampler(maxSamples = 4, maxStatuses = 50) {
  const seen = new Map(); // status -> samples[]
  return {
    note(status, minute, id) {
      if (status == null || status === '') return null;
      const key = String(status);
      if (!seen.has(key)) {
        if (seen.size >= maxStatuses) return null;
        seen.set(key, []);
      }
      const samples = seen.get(key);
      if (samples.length >= maxSamples) return null;
      const label = `${minute ?? 'no-minute'} (${id})`;
      if (samples.some((s) => s.startsWith(String(minute ?? 'no-minute')))) return null; // distinct minutes only
      samples.push(label);
      return `[live-status] api_status=${key} samples (${samples.length}/${maxSamples}): ${samples.join(', ')}`;
    },
    snapshot() { return Object.fromEntries(seen); },
  };
}
