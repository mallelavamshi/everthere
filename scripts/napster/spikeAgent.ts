// Task 4 device spike (scratch): throwaway Napster agent on a STOCK companion, plus a companion-from-picture probe.
// Run from scripts/:
//   pnpm exec tsx napster/spikeAgent.ts agent            -> creates the agent, writes SPIKE_AGENT_ID to ../.env (no printing)
//   pnpm exec tsx napster/spikeAgent.ts probe-companion [url] -> creates a v1 companion from a public pictureUrl, polls GET /companions/{id}
//   pnpm exec tsx napster/spikeAgent.ts session <id>     -> prints GET /sessions/{id} status/closeReason/cost
//   pnpm exec tsx napster/spikeAgent.ts cleanup          -> deletes the spike agent and the probe companion
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { napster } from '../../apps/api/src/napster/client';

const ENV_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
dotenv.config({ path: ENV_PATH, quiet: true });

const INSTRUCTIONS = [
  'You are Spike, a friendly test companion for an engineering check. Keep every reply to one or two short sentences.',
  'Start by saying hello and asking how the user is today.',
  'If the user says they are hurt, call flag_concern with category "injury", a short quote of what they said, and severity "low", then say something kind.',
].join(' ');

/** Set or replace KEY=value in .env without echoing the value. */
function setEnvVar(key: string, value: string) {
  const before = readFileSync(ENV_PATH, 'utf8');
  const re = new RegExp(`^${key}=.*$`, 'm');
  const after = re.test(before) ? before.replace(re, `${key}=${value}`) : `${before.replace(/\n?$/, '\n')}${key}=${value}\n`;
  writeFileSync(ENV_PATH, after);
}

async function main() {
  const key = process.env.NAPSTER_API_KEY;
  if (!key) throw new Error('NAPSTER_API_KEY missing in .env');
  const n = napster(key);
  const [cmd, arg] = process.argv.slice(2);

  if (cmd === 'agent') {
    const stock = await n.listStockCompanions({ gender: 'female', pageSize: 5 });
    const pick = stock.items?.find((c) => c.status === 'completed') ?? stock.items?.[0];
    if (!pick) throw new Error('no stock companion');
    console.log('stock companion fields:', Object.keys(pick).join(','), 'status=', pick.status, 'versions=', JSON.stringify(pick.versions));
    const { id } = await n.createAgent({
      companionId: pick.id,
      name: 'everthere-spike',
      voiceId: 'coral', // Napster rejects agents without a voice (400 VoiceIdRequired)
      language: 'en',
      mode: 'conversation',
      providerSettings: { instructions: INSTRUCTIONS, temperature: 0.6 },
      functions: [process.env.NAPSTER_FLAG_FUNCTION_ID ?? 'flag_concern'],
    });
    setEnvVar('SPIKE_AGENT_ID', id);
    setEnvVar('SPIKE_STOCK_COMPANION_ID', pick.id);
    console.log('agent created; SPIKE_AGENT_ID written to .env');
    return;
  }

  if (cmd === 'probe-companion') {
    // Default: a stable public HTTPS JPEG, a stock companion's own seed photo (pictureUrl must be publicly fetchable).
    // Optional arg: another public HTTPS image (e.g. a 1920x1080 JPEG) to test what Napster accepts.
    const stock = arg ? undefined : await n.listStockCompanions({ gender: 'female', pageSize: 1 });
    const pictureUrl = arg ?? String(stock?.items?.[0]?.previewUrl ?? '');
    if (!pictureUrl.startsWith('https://')) throw new Error('no public picture url');
    const created = await n.createCompanion({ description: 'EverThere spike probe (delete me)', firstName: 'Spike', pictureUrl, version: 'v1' });
    const prev = process.env.SPIKE_PROBE_COMPANION_IDS;
    setEnvVar('SPIKE_PROBE_COMPANION_IDS', prev ? `${prev},${created.id}` : created.id);
    console.log('POST /companions response:', JSON.stringify(created));
    for (let i = 0; i < 20; i++) {
      const c = await n.getCompanion(created.id);
      console.log(`t+${i * 15}s GET /companions/{id}:`, JSON.stringify(c));
      if (c.status === 'readyToUse' || /fail/i.test(String(c.status))) break; // observed: pending -> generationCompleted -> readyToUse
      await new Promise((r) => setTimeout(r, 15_000));
    }
    return;
  }

  if (cmd === 'session') {
    if (!arg) throw new Error('usage: session <sessionId>');
    const s = await n.getSession(arg);
    console.log(JSON.stringify({ status: s.status, closeReason: s.closeReason, cost: s.cost, items: s.items.length }));
    return;
  }

  if (cmd === 'cleanup') {
    if (process.env.SPIKE_AGENT_ID) await n.deleteAgent(process.env.SPIKE_AGENT_ID);
    for (const id of (process.env.SPIKE_PROBE_COMPANION_IDS ?? '').split(',').filter(Boolean)) await n.deleteCompanion(id);
    console.log('spike agent / probe companion deleted');
    return;
  }

  throw new Error('usage: agent | probe-companion | session <id> | cleanup');
}

main().catch((e) => {
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
  process.exit(1);
});
