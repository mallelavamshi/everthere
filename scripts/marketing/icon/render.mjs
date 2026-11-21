// Rasterise every SVG in out/icon2 to PNG, and build a review sheet: each icon as a squircle at 300 px and at 72 px.
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
const DIR = path.join(import.meta.dirname, '..', 'out', 'icon5');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.svg')).sort();
const S = 300, s = 72, pad = 16;
const mask = (n) => Buffer.from(`<svg width="${n}" height="${n}"><rect width="${n}" height="${n}" rx="${n * 0.23}" fill="#fff"/></svg>`);
const tiles = [];
for (const [i, f] of files.entries()) {
  const png = await sharp(path.join(DIR, f)).resize(1024, 1024).png().toBuffer();
  fs.writeFileSync(path.join(DIR, f.replace('.svg', '.png')), png);
  const big = await sharp(png).resize(S, S).composite([{ input: mask(S), blend: 'dest-in' }]).png().toBuffer();
  const small = await sharp(png).resize(s, s).composite([{ input: mask(s), blend: 'dest-in' }]).png().toBuffer();
  const col = i % 4, row = Math.floor(i / 4);
  const x = pad + col * (S + pad), y = pad + row * (S + s + 3 * pad);
  tiles.push({ input: big, left: x, top: y }, { input: small, left: x + (S - s) / 2, top: y + S + pad });
}
const rows = Math.ceil(files.length / 4);
await sharp({ create: { width: 4 * (S + pad) + pad, height: rows * (S + s + 3 * pad) + pad, channels: 3, background: '#F4F1EA' } })
  .composite(tiles).jpeg({ quality: 88 }).toFile(path.join(DIR, '..', 'sheets2', 'icons5.jpg'));
console.log(files.join(', '));
