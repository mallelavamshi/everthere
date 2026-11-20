// Usage: pnpm assets:generate            -> hero only (n=4), then stop for the pick
//        pnpm assets:generate --all      -> every other asset, reference-guided (needs out/reference.png)
//        pnpm assets:generate --only key1,key2
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { metaImages } from '../../apps/api/src/meta/client';
import { genHero, genRest } from './genCore';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
const COST_PER_IMAGE = 0.01;

const key = process.env.META_API_KEY;
if (!key) throw new Error('META_API_KEY missing (set it in the repo-root .env)');
const api = metaImages(key);

const args = process.argv.slice(2);
const onlyIdx = args.indexOf('--only');
const res = args.includes('--all')
  ? await genRest(api, OUT)
  : onlyIdx >= 0
    ? await genRest(api, OUT, { only: args[onlyIdx + 1]!.split(',') })
    : await genHero(api, OUT);
if (res.skipped.length) console.warn('skipped:', res.skipped.join(', '));
console.log(`images generated: ${res.images}, approx cost $${(res.images * COST_PER_IMAGE).toFixed(2)}`);
