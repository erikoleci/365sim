// When the last full import ran (memoised in the key-value table).
import { getKV, setKV } from '../db.js';

// `l365_last_import` used to be read from Postgres on EVERY GET /api/matches
// (ensureLondon365Import runs before the response cache is even consulted).
// The value only changes when an import starts/finishes in THIS process, so
// keep it in memory after the first read; kv_store is still written so a
// restart (or a second instance during a rolling deploy) sees it.
export let lastImportMemo = null;
 // ms epoch, null = not loaded yet
export async function getLastImportAt() {
  if (lastImportMemo == null) lastImportMemo = Number(await getKV('l365_last_import', 0)) || 0;
  return lastImportMemo;
}
export async function setLastImportAt(ts) {
  lastImportMemo = ts;
  await setKV('l365_last_import', ts);
}
