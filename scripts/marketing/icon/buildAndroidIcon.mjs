// Build the Android launcher icon from everthere-icon.svg (the "screen holding a heart" mark, user's pick).
// Adaptive icon (API 26+): background = the sunset gradient, foreground = the white mark on transparent, scaled so it
// sits well inside the 66/108 safe zone of every launcher mask. Legacy icons: the full art in a rounded square / circle.
// Also refreshes apps/mobile/assets/icon-*.png (the 1024 px sources).
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const RES = path.join(ROOT, 'apps/mobile/android/app/src/main/res');
const svg = fs.readFileSync(path.join(import.meta.dirname, 'everthere-icon.svg'), 'utf8');
const defs = svg.match(/<defs>.*<\/defs>/s)[0];
const bgRect = '<rect width="1024" height="1024" fill="url(#bg)"/>';
const mark = svg.slice(svg.indexOf(bgRect) + bgRect.length, svg.lastIndexOf('</svg>'));
const wrap = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${defs}${body}</svg>`;
const scaled = (s) => `<g transform="translate(512 512) scale(${s}) translate(-512 -512)">${mark}</g>`;

const BG = wrap(bgRect);
const FG = wrap(scaled(0.8)); // adaptive: the mask shows the centre ~2/3, so the mark is a bit smaller
const FULL = wrap(bgRect + scaled(1)); // legacy and store: as designed

const png = (s, n) => sharp(Buffer.from(s), { density: 384 }).resize(n, n).png().toBuffer();
const masked = async (s, n, round) => {
  const m = Buffer.from(`<svg width="${n}" height="${n}"><rect width="${n}" height="${n}" rx="${round ? n / 2 : n * 0.22}" fill="#fff"/></svg>`);
  return sharp(await png(s, n)).composite([{ input: m, blend: 'dest-in' }]).png().toBuffer();
};

const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENS)) {
  const dir = path.join(RES, `mipmap-${d}`);
  fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), await png(FG, 108 * k));
  fs.writeFileSync(path.join(dir, 'ic_launcher_background.png'), await png(BG, 108 * k));
  fs.writeFileSync(path.join(dir, 'ic_launcher.png'), await masked(FULL, 48 * k, false));
  fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), await masked(FULL, 48 * k, true));
}
const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
for (const f of ['ic_launcher.xml', 'ic_launcher_round.xml']) fs.writeFileSync(path.join(RES, 'mipmap-anydpi-v26', f), adaptive);

const A = path.join(ROOT, 'apps/mobile/assets');
fs.writeFileSync(path.join(A, 'icon-only.png'), await png(FULL, 1024));
fs.writeFileSync(path.join(A, 'icon-foreground.png'), await png(FG, 1024));
fs.writeFileSync(path.join(A, 'icon-background.png'), await png(BG, 1024));
console.log('android icons written');
