import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSETS } from '../assetList';

const dir = path.resolve(__dirname, '../../../apps/mobile/src/assets');
const manifest = fs.readFileSync(path.join(dir, 'manifest.ts'), 'utf8');

describe('generated manifest', () => {
  const imgBlock = manifest.split('export const img')[1]!.split('export const imgDensity')[0]!;
  const refs = [...manifest.matchAll(/new URL\('\.\/(img\/[^']+)'/g)].map((m) => m[1]!);

  it('has an img entry and AssetKey member for every ASSETS key', () => {
    for (const a of ASSETS) {
      expect(imgBlock, a.key).toContain(`'${a.key}': new URL(`);
      expect(manifest, a.key).toContain(`| '${a.key}'`);
    }
  });

  it('every referenced file exists and is a non-empty webp', () => {
    expect(refs.length).toBeGreaterThanOrEqual(ASSETS.length);
    for (const r of refs) {
      const p = path.join(dir, r);
      expect(fs.existsSync(p), r).toBe(true);
      expect(fs.readFileSync(p).subarray(8, 12).toString(), r).toBe('WEBP');
    }
  });

  it('density assets list 1x/2x/3x', () => {
    for (const a of ASSETS.filter((x) => x.density)) {
      for (const m of [1, 2, 3]) expect(manifest).toContain(`img/${a.key}@${m}x.webp`);
    }
  });
});
