// Creates the Napster `flag_concern` function, or updates the existing one (PUT /public/functions/{id}) when its
// definition differs, else reuses it; then writes its id into the wrangler configs. Idempotent.
// Run: pnpm napster:flag-tool
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import nodePath from 'node:path';
dotenv.config({ path: nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '../../.env'), quiet: true });
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { napster } from '../../apps/api/src/napster/client';
import { FLAG_CATEGORIES, SEVERITIES } from '../../packages/shared/src/domain';

const NAME = 'flag_concern';

export const flagFunctionDef = {
  data: {
    name: NAME,
    description: 'Call immediately, before replying, whenever the child mentions pain or getting hurt (even a small bump or fall), illness, being hit, being scared of a person, or anything unsafe. Alerts the grown-up and the parent.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: [...FLAG_CATEGORIES] },
        quote: { type: 'string', description: "the child's exact words, verbatim" },
        severity: { type: 'string', enum: [...SEVERITIES] },
      },
      required: ['category', 'quote', 'severity'],
    },
  },
  flow: 'implicit' as const,
};

export function setTomlVar(toml: string, id: string): string {
  const re = /^NAPSTER_FLAG_FUNCTION_ID\s*=\s*".*"/m;
  if (!re.test(toml)) throw new Error('NAPSTER_FLAG_FUNCTION_ID line not found in toml');
  return toml.replace(re, `NAPSTER_FLAG_FUNCTION_ID = "${id}"`);
}

type FlagDef = typeof flagFunctionDef;
type FunctionLike = { data?: { name?: string; description?: string; parameters?: unknown }; flow?: string };

/** Sorted keys, null/undefined dropped, `required` sorted: what matters about a definition, in a stable form. */
function canonical(v: unknown, key = ''): unknown {
  if (Array.isArray(v)) {
    const items = v.map((x) => canonical(x));
    return key === 'required' ? [...items].sort() : items;
  }
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== null && x !== undefined) out[k] = canonical(x, k);
    }
    return out;
  }
  return v;
}
const essentials = (f: FunctionLike) => ({
  data: { name: f.data?.name, description: f.data?.description, parameters: f.data?.parameters },
  flow: f.flow,
});

/** True when `existing` (as Napster returns it, extra server fields allowed) already matches `def`. */
export function sameDefinition(existing: FunctionLike, def: FlagDef): boolean {
  return JSON.stringify(canonical(essentials(existing))) === JSON.stringify(canonical(essentials(def)));
}

export type FlagToolNapster = {
  searchFunctions: (search: string) => Promise<unknown>;
  getFunction: (id: string) => Promise<FunctionLike>;
  createFunction: (def: FlagDef) => Promise<{ id: string }>;
  updateFunction: (id: string, def: FlagDef) => Promise<unknown>;
};

/** Create, update (when the definition differs) or reuse the flag function. Safe to run any number of times. */
export async function ensureFlagFunction(n: FlagToolNapster, def: FlagDef = flagFunctionDef): Promise<{ id: string; action: 'created' | 'updated' | 'reused' }> {
  const found = await n.searchFunctions(def.data.name);
  const list = (found as { items?: unknown[] }).items ?? (Array.isArray(found) ? (found as unknown[]) : []);
  const existing = (list as { id: string; name?: string; data?: { name?: string } }[]).find((f) => (f.name ?? f.data?.name) === def.data.name);
  if (!existing) return { id: (await n.createFunction(def)).id, action: 'created' };
  // The search listing may be partial: read the full definition before comparing.
  const current = await n.getFunction(existing.id);
  if (sameDefinition(current, def)) return { id: existing.id, action: 'reused' };
  await n.updateFunction(existing.id, def);
  return { id: existing.id, action: 'updated' };
}

async function main() {
  const key = process.env.NAPSTER_API_KEY;
  if (!key) throw new Error('NAPSTER_API_KEY missing (run with --env-file=../.env)');
  const { id, action } = await ensureFlagFunction(napster(key));
  console.log(`${action === 'created' ? 'Created' : action === 'updated' ? 'Updated the definition of' : 'Reusing existing'} ${NAME}: ${id}`);

  const root = path.resolve(import.meta.dirname, '../..');
  for (const f of ['apps/api/wrangler.toml', 'apps/api/wrangler.test.toml']) {
    const p = path.join(root, f);
    const before = readFileSync(p, 'utf8');
    const after = setTomlVar(before, id);
    if (after !== before) writeFileSync(p, after);
    console.log(`${f}: NAPSTER_FLAG_FUNCTION_ID = "${id}"`);
  }
}

if (process.argv[1]?.endsWith('setupFlagTool.ts')) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
