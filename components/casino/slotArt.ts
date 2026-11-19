// Real slot artwork, when it exists. Pictures live in public/slots/sym/<game id>/<SYMBOL KEY>.<ext> (+ optional bg.<ext>) and are
// listed in public/slots/sym/manifest.json (made by `node scripts/slotArtManifest.mjs`). A game or symbol without a picture keeps the
// emoji drawing, so art can be added game by game without breaking anything.
const art = new Map<string, string>(); // symbol as the game shows it (emoji) -> picture url
let bgUrl = '';
let manifest: Record<string, { keys: string[]; ext: string; bg?: boolean }> | null | undefined;

export const getArt = (symbol: string): string | undefined => art.get(symbol);
export const getBg = () => bgUrl;
export const clearSlotArt = () => { art.clear(); bgUrl = ''; };

export async function loadSlotArt(game: { id: string; symbols: Record<string, string> }): Promise<number> {
  clearSlotArt();
  try {
    if (manifest === undefined) {
      const r = await fetch('/slots/sym/manifest.json', { cache: 'no-cache' });
      manifest = r.ok ? await r.json() : null;
    }
  } catch { manifest = null; }
  const m = manifest?.[game.id];
  if (!m) return 0;
  for (const k of m.keys) { const s = game.symbols[k]; if (s) art.set(s, `/slots/sym/${game.id}/${k}.${m.ext}`); }
  if (m.bg) bgUrl = `/slots/sym/${game.id}/bg.${m.ext}`;
  return art.size;
}
