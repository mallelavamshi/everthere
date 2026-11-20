import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaImageError } from '../../../apps/api/src/meta/client';
import { ASSETS } from '../assetList';
import { genRest, type ImageApi } from '../genCore';

let out: string;
beforeEach(async () => {
  out = await fs.mkdtemp(path.join(os.tmpdir(), 'assets-'));
  await fs.writeFile(path.join(out, 'reference.png'), 'REF');
});

const four = () => Array.from({ length: 4 }, (_, i) => Buffer.from(`img${i}`));
const quiet = () => {};

describe('genRest', () => {
  it('--only edits just those keys with the reference and n:4, writing 1-4.png', async () => {
    const edit = vi.fn().mockResolvedValue(four());
    const api: ImageApi = { generate: vi.fn(), edit };
    const r = await genRest(api, out, { only: ['sticker.bunny'], log: quiet });
    expect(edit).toHaveBeenCalledTimes(1);
    const arg = edit.mock.calls[0]![0];
    expect(arg.n).toBe(4);
    expect(arg.images[0].toString()).toBe('REF');
    expect(arg.prompt).toContain('STYLE only');
    expect(r.images).toBe(4);
    const files = await fs.readdir(path.join(out, 'candidates', 'sticker.bunny'));
    expect(files.sort()).toEqual(['1.png', '2.png', '3.png', '4.png']);
  });

  it('all: skips the hero, covers every other key, concurrency never exceeds 4', async () => {
    let active = 0;
    let peak = 0;
    const edit = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      return four();
    });
    const r = await genRest({ generate: vi.fn(), edit }, out, { concurrency: 99, log: quiet });
    expect(edit).toHaveBeenCalledTimes(ASSETS.length - 1);
    expect(peak).toBeLessThanOrEqual(4);
    expect(r.skipped).toEqual([]);
  });

  it('retries a policy block once with a softened prompt, then logs the skip', async () => {
    const blocked = new MetaImageError('no', 400, 'content_policy_violation');
    const edit = vi.fn().mockRejectedValue(blocked);
    const r = await genRest({ generate: vi.fn(), edit }, out, { only: ['reason.boo_boo'], log: quiet });
    expect(edit).toHaveBeenCalledTimes(2);
    expect(edit.mock.calls[1]![0].prompt).toContain('family-friendly');
    expect(r.skipped).toEqual(['reason.boo_boo']);
    expect(r.images).toBe(0);
  });

  it('succeeds when the softened retry passes', async () => {
    const edit = vi
      .fn()
      .mockRejectedValueOnce(new MetaImageError('no', 400, 'content_policy_violation'))
      .mockResolvedValueOnce(four());
    const r = await genRest({ generate: vi.fn(), edit }, out, { only: ['reason.boo_boo'], log: quiet });
    expect(r.images).toBe(4);
    expect(r.skipped).toEqual([]);
  });

  it('errors clearly when reference.png is missing', async () => {
    await fs.rm(path.join(out, 'reference.png'));
    await expect(genRest({ generate: vi.fn(), edit: vi.fn() }, out)).rejects.toThrow(/reference/);
  });
});
