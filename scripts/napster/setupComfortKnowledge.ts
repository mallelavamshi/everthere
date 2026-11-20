// Task 32: the Napster knowledge every EverThere agent shares. Idempotent: run it any number of times.
//   1. FAQ collection "EverThere: little questions" (content/faqs.ts): created, or synced item by item
//      (missing questions added, changed answers updated; nothing deleted).
//   2. Knowledge base "EverThere: calm-down corner" with content/calm-corner.md. The file is named by a hash of its
//      text, so an edited file is uploaded as a new file (the old one stays; nothing is deleted). Napster downloads it
//      from a public URL: the script puts it in R2 (wrangler --remote) and passes a signed /m link.
//   3. Writes NAPSTER_FAQ_COLLECTION_ID and NAPSTER_KNOWLEDGE_BASE_ID into apps/api/wrangler.toml [vars].
// Then deploy the Worker and run `pnpm napster:sync-agents --apply` so existing agents get them too.
// Run: pnpm napster:knowledge          (needs NAPSTER_API_KEY, MEDIA_SIGNING_KEY, API_BASE in .env; wrangler login)
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import nodePath from 'node:path';
dotenv.config({ path: nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '../../.env'), quiet: true });
import { createHash, createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { napster, type FaqCollection, type FaqItem, type KnowledgeBase, type KnowledgeFile } from '../../apps/api/src/napster/client';
import { COMFORT_FAQS, FAQ_COLLECTION_NAME, type Faq } from './content/faqs';

export const KNOWLEDGE_BASE_NAME = 'EverThere: calm-down corner';
const ROOT = path.resolve(import.meta.dirname, '../..');
const API_DIR = path.join(ROOT, 'apps/api');
const CALM_CORNER = path.join(import.meta.dirname, 'content/calm-corner.md');
const BUCKET = 'everthere-media';

const listOf = <T>(r: { items?: T[] } | T[] | undefined): T[] => (Array.isArray(r) ? r : (r?.items ?? []));
const norm = (s: string) => s.trim().replace(/\s+/g, ' ');

export type KnowledgeNapster = {
  listFaqCollections: () => Promise<{ items?: FaqCollection[] } | FaqCollection[]>;
  listFaqItems: (id: string) => Promise<{ items?: FaqItem[] } | FaqItem[]>;
  createFaqCollection: (b: { name: string; faqs?: Faq[] }) => Promise<FaqCollection>;
  addFaqItem: (collectionId: string, b: Faq) => Promise<unknown>;
  updateFaqItem: (collectionId: string, itemId: string, b: { answer: string }) => Promise<unknown>;
  listKnowledgeBases: () => Promise<{ items?: KnowledgeBase[] } | KnowledgeBase[]>;
  createKnowledgeBase: (b: { name: string; provider: 'azureOpenAI' }) => Promise<KnowledgeBase>;
  listKnowledgeBaseFiles: (id: string) => Promise<{ items?: KnowledgeFile[] } | KnowledgeFile[]>;
  uploadKnowledgeBaseFile: (id: string, b: { url: string }) => Promise<KnowledgeFile>;
};

/** Create the collection with every pair, or bring an existing one up to date (add and update only). */
export async function ensureFaqCollection(
  n: KnowledgeNapster,
  faqs: readonly Faq[] = COMFORT_FAQS,
  name = FAQ_COLLECTION_NAME,
): Promise<{ id: string; action: 'created' | 'synced'; added: number; updated: number }> {
  if (faqs.length > 50) throw new Error(`a Napster FAQ collection holds at most 50 pairs (have ${faqs.length})`);
  const existing = listOf(await n.listFaqCollections()).find((c) => c.name === name);
  if (!existing) {
    const c = await n.createFaqCollection({ name, faqs: [...faqs] });
    return { id: c.id, action: 'created', added: faqs.length, updated: 0 };
  }
  const items = listOf(await n.listFaqItems(existing.id));
  let added = 0;
  let updated = 0;
  for (const f of faqs) {
    const it = items.find((i) => norm(i.question) === norm(f.question));
    if (!it) {
      await n.addFaqItem(existing.id, f);
      added++;
    } else if (norm(it.answer) !== norm(f.answer)) {
      await n.updateFaqItem(existing.id, it.id, { answer: f.answer });
      updated++;
    }
  }
  return { id: existing.id, action: 'synced', added, updated };
}

/** The calm-corner file's name in Napster and R2: changes whenever its text changes. */
export const knowledgeFileName = (text: string) => `calm-corner-${createHash('sha256').update(text).digest('hex').slice(0, 10)}.md`;

/** Create the knowledge base if needed, and upload the file unless a file of that exact name is already in it. */
export async function ensureKnowledgeBase(
  n: KnowledgeNapster,
  fileName: string,
  publicUrl: () => Promise<string>,
  name = KNOWLEDGE_BASE_NAME,
): Promise<{ id: string; created: boolean; uploaded: boolean }> {
  let kb = listOf(await n.listKnowledgeBases()).find((k) => k.name === name);
  const created = !kb;
  if (!kb) kb = await n.createKnowledgeBase({ name, provider: 'azureOpenAI' });
  const files = created ? [] : listOf(await n.listKnowledgeBaseFiles(kb.id));
  if (files.some((f) => f.originalName === fileName)) return { id: kb.id, created, uploaded: false };
  await n.uploadKnowledgeBaseFile(kb.id, { url: await publicUrl() });
  return { id: kb.id, created, uploaded: true };
}

/** Set (or add, at the end of [vars]) `NAME = "value"` in a wrangler.toml. */
export function setVar(toml: string, name: string, value: string): string {
  const re = new RegExp(`^${name}\\s*=\\s*".*"`, 'm');
  if (re.test(toml)) return toml.replace(re, `${name} = "${value}"`);
  const vars = /^\[vars\]\s*$/m.exec(toml);
  if (!vars) throw new Error('[vars] section not found in wrangler.toml');
  const start = vars.index + vars[0].length;
  const next = /^\[/m.exec(toml.slice(start));
  const end = next ? start + next.index : toml.length;
  const body = toml.slice(start, end).replace(/\s*$/, '\n');
  return `${toml.slice(0, start)}${body}${name} = "${value}"\n${next ? '\n' : ''}${toml.slice(end)}`;
}

function need(k: string): string {
  const v = process.env[k]?.trim();
  if (!v) throw new Error(`${k} missing in .env`);
  return v;
}

function r2PutText(key: string, file: string): void {
  const r = spawnSync('pnpm', ['exec', 'wrangler', 'r2', 'object', 'put', `"${BUCKET}/${key}"`, '--file', `"${file}"`, '--content-type', 'text/markdown', '--remote'], {
    cwd: API_DIR,
    stdio: 'inherit',
    shell: true,
  });
  if (r.status !== 0) throw new Error(`wrangler r2 object put ${key} failed (exit ${r.status})`);
}

function signedUrl(key: string, ttlMs = 60 * 60_000): string {
  const exp = Date.now() + ttlMs;
  const sig = createHmac('sha256', need('MEDIA_SIGNING_KEY')).update(`${key}|${exp}`).digest('hex');
  return `${need('API_BASE').replace(/\/+$/, '')}/m/${encodeURIComponent(key)}?exp=${exp}&sig=${sig}`;
}

async function main() {
  const n = napster(need('NAPSTER_API_KEY'));
  const faq = await ensureFaqCollection(n);
  console.log(`FAQ collection "${FAQ_COLLECTION_NAME}": ${faq.id} (${faq.action}; ${faq.added} added, ${faq.updated} updated)`);

  const text = readFileSync(CALM_CORNER, 'utf8');
  const fileName = knowledgeFileName(text);
  const key = `knowledge/${fileName}`;
  const kb = await ensureKnowledgeBase(n, fileName, async () => {
    r2PutText(key, CALM_CORNER);
    return signedUrl(key);
  });
  console.log(`Knowledge base "${KNOWLEDGE_BASE_NAME}": ${kb.id} (${kb.created ? 'created' : 'existing'}; ${kb.uploaded ? `uploaded ${fileName}` : `${fileName} already there`})`);

  const p = path.join(API_DIR, 'wrangler.toml');
  const before = readFileSync(p, 'utf8');
  const after = setVar(setVar(before, 'NAPSTER_FAQ_COLLECTION_ID', faq.id), 'NAPSTER_KNOWLEDGE_BASE_ID', kb.id);
  if (after !== before) writeFileSync(p, after);
  console.log('apps/api/wrangler.toml: NAPSTER_FAQ_COLLECTION_ID and NAPSTER_KNOWLEDGE_BASE_ID set. Deploy the Worker, then run pnpm napster:sync-agents.');
}

if (process.argv[1]?.endsWith('setupComfortKnowledge.ts')) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
