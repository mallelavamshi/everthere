// Usage: tsx assets/removeBg.ts [--only k1,k2]
// Cuts out the picked candidate of every transparent:true asset -> out/cutouts/<key>.png
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeBackground } from '@imgly/background-removal-node';
import { ASSETS } from './assetList';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
const picks: Record<string, number> = JSON.parse(await fs.readFile(path.join(OUT, 'picks.json'), 'utf8'));
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1]!.split(',') : null;

await fs.mkdir(path.join(OUT, 'cutouts'), { recursive: true });
for (const a of ASSETS.filter((x) => x.transparent && (!only || only.includes(x.key)))) {
  const src = path.join(OUT, 'candidates', a.key, `${picks[a.key] ?? 1}.png`);
  const buf = await fs.readFile(src);
  const blob = await removeBackground(new Blob([buf], { type: 'image/png' }), {
    model: 'medium',
    output: { format: 'image/png' },
  });
  await fs.writeFile(path.join(OUT, 'cutouts', `${a.key}.png`), Buffer.from(await blob.arrayBuffer()));
  console.log(`cutout ${a.key}`);
}
