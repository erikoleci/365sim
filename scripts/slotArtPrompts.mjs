// Writes the image-generation prompts for every slot symbol: node scripts/slotArtPrompts.mjs > prompts.md
import { SLOT_GAMES } from '../server/slots/games.js';
const THEME = {
  classic: 'polished chrome and red enamel casino style, glossy, bright and bold, Las Vegas',
  egypt: 'ancient Egyptian gold and lapis lazuli, carved sandstone details, warm torchlight',
  gems: 'faceted luxury jewel look, crystal refraction, violet and blue sparkle, royal',
  western: 'wild west, worn wood and brass, dusty gold, rivets, cinematic sunset light',
  asia: 'east-Asian red lacquer and gold ornament, silk and ink details, festive',
  nordic: 'nordic viking, frosted steel, carved runes, cold blue light, epic',
  space: 'sci-fi neon, glowing cyan and magenta rim light, dark space background glow',
  candy: 'sweet candy, glossy sugar, soft pastel pink, shiny, playful',
  aztec: 'ancient Aztec and jungle stone, carved temple relief, orange sun light',
  ocean: 'underwater, pearly teal glow, caustic light, shells and bubbles',
  magic: 'fantasy magic, purple and emerald glow, sparkles, enchanted',
  sport: 'stadium sport, vivid green grass, dynamic lighting, trophy shine',
};
const MAP = { 'hot-fruits': 'classic', 'blazing-sevens': 'classic', 'fire-fruits-40': 'classic', 'mega-hot-100': 'classic', 'lucky-seven-wheel': 'classic', 'fruit-carnival': 'classic', 'pharaoh-gold': 'egypt', 'desert-explorer': 'egypt', 'diamond-rush': 'gems', 'royal-gems': 'gems', 'golden-lady': 'gems', 'jester-jackpot': 'gems', 'wild-west-gold': 'western', 'gold-miner': 'western', 'lucky-dragon': 'asia', 'samurai-blade': 'asia', 'viking-fortune': 'nordic', 'mystic-wolf': 'nordic', 'arctic-fortune': 'nordic', 'space-odyssey': 'space', 'night-racer': 'space', 'candy-blast': 'candy', 'aztec-sun': 'aztec', 'jungle-safari': 'aztec', 'ocean-pearls': 'ocean', 'pirate-treasure': 'ocean', 'merlin-spell': 'magic', 'emerald-clover': 'magic', 'money-rush': 'magic', 'football-fever': 'sport' };
const human = (k) => k.toLowerCase().replace(/_/g, ' ');
const rows = [];
let md = `# Slot artwork: prompts\n\nPër çdo lojë: një skedar për simbol, emri i skedarit = çelësi (p.sh. \`CHERRY.png\`) në dosjen \`public/slots/sym/<id-e-lojës>/\`. Opsionale: \`bg.png\` (sfondi, portret 9:16).\n\n**Rregullat e përbashkëta (shtoji çdo prompti):** square 1:1, 1024x1024, the symbol centered and filling about 80% of the frame, soft rounded-square badge background in a deep colour that matches the theme, glossy 3D rendered game-icon style (like a premium 2026 mobile slot game), strong rim light, subtle drop shadow, high detail, no text, no letters, no watermark, no border outside the badge.\n\n`;
for (const g of SLOT_GAMES) {
  const t = MAP[g.id] || 'classic'; const style = THEME[t];
  md += `## ${g.name} (\`${g.id}\`) · ${t}\nTemë: ${g.tagline}. Stil: ${style}.\n\n`;
  for (const k of Object.keys(g.symbols)) {
    let subject;
    if (k === 'WILD') subject = `the WILD symbol of the game "${g.name}": ${g.wildName || 'wild'}, the most special golden ornate emblem, glowing, ${g.wildExpand ? 'tall and expanding feel' : 'radiant'}`;
    else if (k === 'SCATTER') subject = `the SCATTER / bonus symbol of the game "${g.name}": ${g.scatterName || 'scatter'}, a mystical glowing emblem that promises free spins`;
    else subject = `${human(k)} (in the theme of "${g.name}")`;
    const prompt = `${subject}, ${style}, premium slot machine symbol icon`;
    md += `- \`${k}.png\`: ${prompt}\n`;
    rows.push([g.id, k, prompt]);
  }
  md += `- \`bg.png\` (optional, 9:16, 1080x1920): ${g.name} slot game background scene, ${style}, atmospheric, no characters in the center, empty middle area for the reels, no text\n\n`;
}
process.stdout.write(md);
process.stderr.write(`${rows.length} symbol prompts, ${SLOT_GAMES.length} games\n`);
