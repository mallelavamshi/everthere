// Usage: tsx assets/optimize.ts
// Reads curation/picks.json (tracked) + out/candidates (+ out/cutouts for transparent assets) and writes
//   apps/mobile/src/assets/img/**, apps/mobile/src/assets/manifest.ts,
//   apps/mobile/assets/{icon-only,icon-foreground,icon-background,splash}.png (+ store/feature-graphic.png)
// Meta ignores requested sizes (1600x1600, 2016x1152, 1920x1280), so every asset is normalised
// to its intended aspect: cover-crop when the source is wider, extend with the sampled
// background colour when narrower. Never stretched.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { centerOnCanvas, fitAspect, iconForeground, onSquare } from './imageOps';
import { ASSETS, type AssetSpec } from './assetList';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out'); // candidates + cutouts only
const PICKS = path.join(HERE, 'curation', 'picks.json');
const MOBILE = path.join(HERE, '..', '..', 'apps', 'mobile');
const IMG = path.join(MOBILE, 'src', 'assets', 'img');
const CAP = path.join(MOBILE, 'assets');
const Q = 82;

const ASPECT: Record<AssetSpec['size'], number> = { '1024x1024': 1, '1792x1024': 1792 / 1024, '1024x1792': 1024 / 1792 };
const WIDE_W = 1400;
const SQUARE_W = 768;

function baseDensity(a: AssetSpec) {
  if (a.group === 'empty' || a.key.startsWith('moment.creating')) return 192;
  return 128; // stickers, reasons, classroom emblems
}

const webp = (b: Buffer | sharp.Sharp) => (Buffer.isBuffer(b) ? sharp(b) : b).webp({ quality: Q, alphaQuality: 90 }).toBuffer();

async function main() {
  const picks: Record<string, number> = JSON.parse(await fs.readFile(PICKS, 'utf8'));
  await fs.rm(IMG, { recursive: true, force: true });
  await fs.mkdir(IMG, { recursive: true });
  await fs.mkdir(path.join(CAP, 'store'), { recursive: true });

  const entries: { key: string; files: string[] }[] = [];
  let bytes = 0;
  const write = async (name: string, buf: Buffer) => {
    await fs.writeFile(path.join(IMG, name), buf);
    bytes += buf.length;
  };

  for (const a of ASSETS) {
    const cand = path.join(OUT, 'candidates', a.key, `${picks[a.key] ?? 1}.png`);
    const cut = path.join(OUT, 'cutouts', `${a.key}.png`);
    const files: string[] = [];

    if (a.transparent) {
      const src = await fs.readFile(cut).catch(() => {
        throw new Error(`missing cutout for ${a.key}: run removeBg first`);
      });
      const trim = !a.key.startsWith('moment.creating'); // keep frames aligned for the loop
      const master = await onSquare(src, 1024, 940, trim);
      if (a.density) {
        const base = baseDensity(a);
        for (const m of [1, 2, 3]) {
          const name = `${a.key}@${m}x.webp`;
          await write(name, await webp(sharp(master).resize(base * m, base * m)));
          files.push(name);
        }
      } else {
        const name = `${a.key}.webp`;
        await write(name, await webp(sharp(master).resize(SQUARE_W, SQUARE_W)));
        files.push(name);
      }
    } else {
      const aspect = ASPECT[a.size];
      const name = `${a.key}.webp`;
      if (aspect < 1) {
        // portrait (splash): extend the background around the centred art, no crop, no upscale
        const [pw, ph] = a.size.split('x').map(Number) as [number, number];
        await write(name, await webp(await centerOnCanvas(cand, pw, ph)));
      } else {
        const fitted = await fitAspect(cand, aspect);
        const w = aspect === 1 ? SQUARE_W : WIDE_W;
        await write(name, await webp(sharp(fitted).resize(w, Math.round(w / aspect), { fit: 'cover' })));
      }
      files.push(name);
    }
    entries.push({ key: a.key, files });
  }

  // ---- Capacitor sources -------------------------------------------------------------
  const iconCut = await fs.readFile(path.join(OUT, 'cutouts', 'brand.icon.png'));
  const bgSq = await fitAspect(path.join(OUT, 'candidates', 'brand.iconBackground', `${picks['brand.iconBackground'] ?? 1}.png`), 1);
  const iconBg = await sharp(bgSq).resize(1024, 1024).png().toBuffer();
  // adaptive foreground: art inside the central 66% safe zone (use 60% for margin)
  const fg = await iconForeground(iconCut);
  const only = await sharp(iconBg)
    .composite([{ input: await onSquare(iconCut, 1024, Math.round(1024 * 0.8)) }])
    .png()
    .toBuffer();
  await fs.writeFile(path.join(CAP, 'icon-background.png'), iconBg);
  await fs.writeFile(path.join(CAP, 'icon-foreground.png'), fg);
  await fs.writeFile(path.join(CAP, 'icon-only.png'), only);

  // splash: 2732 square, art centred at native size (never upscaled), background extended around it
  const splashSrc = path.join(OUT, 'candidates', 'brand.splash', `${picks['brand.splash'] ?? 1}.png`);
  await fs.writeFile(path.join(CAP, 'splash.png'), await centerOnCanvas(splashSrc, 2732, 2732));

  // Play Store feature graphic is exactly 1024x500
  const fgSrc = path.join(OUT, 'candidates', 'brand.featureGraphic', `${picks['brand.featureGraphic'] ?? 1}.png`);
  await sharp(fgSrc).resize(1024, 500, { fit: 'cover' }).png().toFile(path.join(CAP, 'store', 'feature-graphic.png'));

  // ---- manifest ---------------------------------------------------------------------
  const url = (f: string) => `new URL('./img/${f}', import.meta.url).href`;
  const keys = entries.map((e) => `  | '${e.key}'`).join('\n');
  const imgLines = entries
    .map((e) => `  '${e.key}': ${url(e.files.length === 3 ? e.files[1]! : e.files[0]!)},`)
    .join('\n');
  const setLines = entries
    .filter((e) => e.files.length === 3)
    .map((e) => `  '${e.key}': [${e.files.map(url).join(', ')}],`)
    .join('\n');
  const manifest = `// GENERATED by scripts/assets/optimize.ts. Do not edit.
export type AssetKey =
${keys};

/** URL of the asset (2x variant for density assets). */
export const img: Record<AssetKey, string> = {
${imgLines}
};

/** [1x, 2x, 3x] URLs for density assets; build a srcset with imgSrcSet(). */
export const imgDensity: Partial<Record<AssetKey, [string, string, string]>> = {
${setLines}
};

export const imgSrcSet = (key: AssetKey): string | undefined => {
  const d = imgDensity[key];
  return d ? \`\${d[0]} 1x, \${d[1]} 2x, \${d[2]} 3x\` : undefined;
};
`;
  await fs.writeFile(path.join(MOBILE, 'src', 'assets', 'manifest.ts'), manifest);
  console.log(`assets: ${entries.length}, files: ${entries.reduce((n, e) => n + e.files.length, 0)}, webp bytes: ${(bytes / 1024).toFixed(0)} KiB`);
}
await main();
