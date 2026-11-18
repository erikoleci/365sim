// Scans public/slots/sym/<game id>/ and writes public/slots/sym/manifest.json. Run after adding pictures.
import fs from 'fs';
import path from 'path';
const root = path.resolve('public/slots/sym');
fs.mkdirSync(root, { recursive: true });
const out = {};
for (const d of fs.readdirSync(root, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  const files = fs.readdirSync(path.join(root, d.name)).filter((f) => /\.(png|webp|jpg|jpeg)$/i.test(f));
  const ext = (files[0] || '').split('.').pop();
  const keys = files.filter((f) => !/^bg\./i.test(f)).map((f) => f.replace(/\.[^.]+$/, ''));
  if (keys.length) out[d.name] = { keys, ext, bg: files.some((f) => /^bg\./i.test(f)) };
}
fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(out, null, 1));
console.log(`${Object.keys(out).length} games with art`);
