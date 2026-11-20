// Generate the marketing scenes' green-screen candidates with Meta muse-image-1.0 (about $0.01 per image).
// Run: pnpm --dir scripts exec tsx marketing/generate.ts [--n 3] [--only 01-daycare-tablet-girl,02-...]
// Output: scripts/marketing/out/scenes/<key>/<i>.png (git-ignored).
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env'), quiet: true });
import fs from 'node:fs/promises';
import { metaImages, MetaImageError } from '../../apps/api/src/meta/client';
import { SCENES } from './scenes';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'scenes');
const key = process.env.META_API_KEY;
if (!key) throw new Error('META_API_KEY missing in .env');
const api = metaImages(key);

const args = process.argv.slice(2);
const at = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const n = Number(at('--n') ?? 3);
const only = at('--only')?.split(',');
const todo = SCENES.filter((s) => !only || only.includes(s.key));

let images = 0;
await Promise.all(
  todo.map(async (s) => {
    try {
      const bufs = await api.generate({ prompt: s.prompt, n, size: s.size, outputFormat: 'png' });
      const dir = path.join(OUT, s.key);
      await fs.mkdir(dir, { recursive: true });
      const start = (await fs.readdir(dir)).filter((f) => f.endsWith('.png')).length;
      await Promise.all(bufs.map((b, i) => fs.writeFile(path.join(dir, `${start + i + 1}.png`), b)));
      images += bufs.length;
      console.log(`${s.key}: ${bufs.length}`);
    } catch (e) {
      console.warn(`${s.key}: FAILED ${e instanceof MetaImageError ? e.code : e instanceof Error ? e.message : e}`);
    }
  }),
);
console.log(`images: ${images}, about $${(images * 0.01).toFixed(2)}`);
