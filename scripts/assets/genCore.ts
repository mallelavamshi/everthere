import fs from 'node:fs/promises';
import path from 'node:path';
import { MetaImageError } from '../../apps/api/src/meta/client';
import { ASSETS, type AssetSpec } from './assetList';

export const HERO = 'onboarding.hero';

export interface ImageApi {
  generate(o: { prompt: string; n: number; size: AssetSpec['size']; outputFormat?: 'png' }): Promise<Buffer[]>;
  edit(o: { prompt: string; images: Buffer[]; n: number }): Promise<Buffer[]>;
}

export const soften = (p: string) =>
  `${p} Keep it gentle, wholesome and family-friendly; a simple, abstract, toy-like depiction.`;

// The reference supplies style only; subjects, ages and hair colors come from the prompt.
export const editPrompt = (p: string) =>
  `${p} Use the reference image for STYLE only (clay-toy look, lighting, palette, cream background); do not copy its characters, hair colors or composition.`;

export interface Result {
  images: number;
  skipped: string[];
}

async function save(outDir: string, spec: AssetSpec, bufs: Buffer[]) {
  const dir = path.join(outDir, 'candidates', spec.key);
  await fs.mkdir(dir, { recursive: true });
  await Promise.all(bufs.map((b, i) => fs.writeFile(path.join(dir, `${i + 1}.png`), b)));
  return dir;
}

export async function withPolicyRetry(
  spec: AssetSpec,
  run: (prompt: string) => Promise<Buffer[]>,
  log: (m: string) => void = console.warn,
): Promise<Buffer[] | null> {
  const prompts = [spec.prompt, soften(spec.prompt)];
  for (let i = 0; i < prompts.length; i++) {
    try {
      return await run(prompts[i]!);
    } catch (e) {
      if (e instanceof MetaImageError && e.code === 'content_policy_violation') {
        log(`policy block: ${spec.key}${i === 0 ? ' (retrying softened)' : ' (skipped)'}`);
        continue;
      }
      throw e;
    }
  }
  return null;
}

export async function genHero(api: ImageApi, outDir: string): Promise<Result> {
  const spec = ASSETS.find((x) => x.key === HERO)!;
  const bufs = await withPolicyRetry(spec, (prompt) =>
    api.generate({ prompt, n: 4, size: spec.size, outputFormat: 'png' }),
  );
  if (!bufs) return { images: 0, skipped: [HERO] };
  await save(outDir, spec, bufs);
  return { images: bufs.length, skipped: [] };
}

export async function genRest(
  api: ImageApi,
  outDir: string,
  opts: { only?: string[]; concurrency?: number; log?: (m: string) => void } = {},
): Promise<Result> {
  const log = opts.log ?? console.log;
  const reference = await fs.readFile(path.join(outDir, 'reference.png')).catch(() => {
    throw new Error('out/reference.png missing: pick the hero first');
  });
  const todo = ASSETS.filter((x) => x.key !== HERO && (!opts.only || opts.only.includes(x.key)));
  const result: Result = { images: 0, skipped: [] };
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const spec = todo[next++]!;
      try {
        const bufs = await withPolicyRetry(
          spec,
          (prompt) => api.edit({ prompt: editPrompt(prompt), images: [reference], n: 4 }),
          log,
        );
        if (!bufs) {
          result.skipped.push(spec.key);
          continue;
        }
        await save(outDir, spec, bufs);
        result.images += bufs.length;
        log(`${spec.key}: ${bufs.length} candidates`);
      } catch (e) {
        // Non-policy failure (network, rate limit): log and continue; re-run with --only.
        log(`FAILED ${spec.key}: ${(e as Error).message}`);
        result.skipped.push(spec.key);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, 4) }, worker));
  return result;
}
