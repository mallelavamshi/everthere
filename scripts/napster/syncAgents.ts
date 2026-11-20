// Task 32: bring every EverThere agent that is in use up to date. Agent instructions live on the Napster agent, so a
// prompt change reaches existing avatars only through a PATCH. For each avatar in D1 with an agent, this PATCHes:
//   providerSettings (the current comforting instructions, temperature, far-field noise reduction),
//   the shared FAQ collection and knowledge base (when configured), and disableIdleTimeout.
// It never touches voices, companions or tools, never creates or deletes anything, and only agents D1 references
// (retired seed agents are left alone).
// Run: pnpm napster:sync-agents            dry run: prints what it would change
//      pnpm napster:sync-agents --apply    PATCHes the agents
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import nodePath from 'node:path';
dotenv.config({ path: nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '../../.env'), quiet: true });
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { napster } from '../../apps/api/src/napster/client';
import { agentProviderSettings, agentResources, firstNameOf } from '../../apps/api/src/services/avatars';
import { buildAgentInstructions } from '../../packages/shared/src/prompt';

const ROOT = path.resolve(import.meta.dirname, '../..');
const API_DIR = path.join(ROOT, 'apps/api');

export type AgentRow = { avatarId: string; agentId: string; parentTitle: string; ownerName: string | null };

/** The PATCH body for one agent: what every agent created today would get, minus voice, companion and tools. */
export function agentPatch(row: AgentRow, vars: { NAPSTER_FAQ_COLLECTION_ID?: string; NAPSTER_KNOWLEDGE_BASE_ID?: string }) {
  return {
    providerSettings: agentProviderSettings(buildAgentInstructions(firstNameOf(row.ownerName ?? ''), row.parentTitle)),
    ...agentResources(vars),
  };
}

export async function syncAgents(
  rows: readonly AgentRow[],
  vars: { NAPSTER_FAQ_COLLECTION_ID?: string; NAPSTER_KNOWLEDGE_BASE_ID?: string },
  patch: ((id: string, body: Record<string, unknown>) => Promise<unknown>) | null,
  log: (s: string) => void = console.log,
): Promise<{ patched: number; failed: number }> {
  let patched = 0;
  let failed = 0;
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.agentId)) continue;
    seen.add(r.agentId);
    const body = agentPatch(r, vars);
    const what = `${r.parentTitle} (${firstNameOf(r.ownerName ?? '')}) agent ${r.agentId}`;
    if (!patch) {
      log(`would patch ${what}: instructions ${body.providerSettings.instructions!.length} chars, faq ${body.faqCollections?.[0] ?? '-'}, kb ${body.knowledgeBaseId ?? '-'}, no idle timeout`);
      continue;
    }
    try {
      await patch(r.agentId, body);
      patched++;
      log(`patched ${what}`);
    } catch (e) {
      failed++;
      log(`FAILED ${what}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { patched, failed };
}

function wranglerVar(name: string): string {
  const m = new RegExp(`^${name}\\s*=\\s*"(.*)"`, 'm').exec(readFileSync(path.join(API_DIR, 'wrangler.toml'), 'utf8'));
  return m?.[1] ?? '';
}

function d1Rows(): AgentRow[] {
  const sql =
    'SELECT a.id AS avatarId, a.napster_agent_id AS agentId, a.parent_title AS parentTitle, u.name AS ownerName FROM avatar a LEFT JOIN user u ON u.id = a.user_id WHERE a.napster_agent_id IS NOT NULL';
  const r = spawnSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'everthere', '--remote', '--json', '--command', `"${sql}"`], {
    cwd: API_DIR,
    shell: true,
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`wrangler d1 execute failed (exit ${r.status}): ${r.stderr}`);
  const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('['))) as { results: AgentRow[] }[];
  return out[0]?.results ?? [];
}

async function main() {
  const apply = process.argv.includes('--apply');
  const key = process.env.NAPSTER_API_KEY?.trim();
  if (!key) throw new Error('NAPSTER_API_KEY missing in .env');
  const vars = { NAPSTER_FAQ_COLLECTION_ID: wranglerVar('NAPSTER_FAQ_COLLECTION_ID'), NAPSTER_KNOWLEDGE_BASE_ID: wranglerVar('NAPSTER_KNOWLEDGE_BASE_ID') };
  const rows = d1Rows();
  console.log(`${rows.length} avatars with agents in D1${apply ? '' : ' (dry run; pass --apply to patch)'}`);
  const n = napster(key);
  const { patched, failed } = await syncAgents(rows, vars, apply ? (id, body) => n.patchAgent(id, body) : null);
  if (apply) console.log(`${patched} patched, ${failed} failed`);
  if (failed) process.exit(1);
}

if (process.argv[1]?.endsWith('syncAgents.ts')) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
