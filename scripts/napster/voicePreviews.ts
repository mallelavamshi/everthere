// Renders one Napster recording per voice on a stock companion and extracts AAC audio clips.
// Run: pnpm napster:voices   (costs Napster credit; skips voices whose clip already exists)
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import nodePath from 'node:path';
dotenv.config({ path: nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '../../.env'), quiet: true });
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { napster, NapsterError } from '../../apps/api/src/napster/client';
import { VOICES } from '../../packages/shared/src/domain';

const TEXT = 'Hi sweetie! I love you to the moon and back.';
const POLL_MS = 5000;
const MAX_MS = 3 * 60_000;
export const HARD_MAX_RECORDINGS = 10;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function removeQuietly(p: string) {
  try {
    unlinkSync(p);
  } catch {
    /* already gone */
  }
}

/** MAX_RECORDINGS may lower the cap, never raise it above 10. */
export function recordingCap(envValue: string | undefined): number {
  const n = Number(envValue);
  if (envValue === undefined || envValue === '' || !Number.isFinite(n) || n < 0) return HARD_MAX_RECORDINGS;
  return Math.min(Math.floor(n), HARD_MAX_RECORDINGS);
}

/** Docs only show "pending"; terminal values are undocumented, so stay defensive and fail fast on fail/error. */
export function classifyStatus(status: unknown): 'done' | 'failed' | 'wait' {
  const s = String(status ?? '').toLowerCase();
  if (s.includes('fail') || s.includes('error')) return 'failed';
  if (['completed', 'complete', 'done', 'ready', 'succeeded', 'success'].includes(s)) return 'done';
  return 'wait';
}

async function main() {
  const key = process.env.NAPSTER_API_KEY;
  if (!key) throw new Error('NAPSTER_API_KEY missing');
  const n = napster(key);
  const outDir = path.resolve(import.meta.dirname, '../../apps/mobile/src/assets/voices');
  mkdirSync(outDir, { recursive: true });
  const ffmpeg = process.env.FFMPEG_PATH ?? (ffmpegPath as unknown as string | null) ?? 'ffmpeg';

  const cap = recordingCap(process.env.MAX_RECORDINGS);
  const missing = VOICES.filter((v) => !existsSync(path.join(outDir, `${v}.m4a`)));
  if (missing.length > HARD_MAX_RECORDINGS) throw new Error(`Refusing: ${missing.length} clips missing, more than ${HARD_MAX_RECORDINGS}`);
  console.log(`Missing clips: ${missing.length}; recording cap: ${cap}`);

  const stock = await n.listStockCompanions({ pageIndex: 0, pageSize: 5 });
  const list = (stock.items ?? (Array.isArray(stock) ? stock : [])) as { id: string }[];
  const companionId = list[0]?.id;
  if (!companionId) throw new Error('No stock companion found');
  console.log(`Stock companion: ${companionId}`);

  const ok: string[] = [];
  const failed: string[] = [];
  let created = 0;
  let totalCost = 0;
  let sawCost = false;
  const seenStatuses = new Set<string>();
  const note = (r: { status?: unknown; cost?: unknown }) => {
    const st = String(r.status);
    if (!seenStatuses.has(st)) {
      seenStatuses.add(st);
      console.log(`  raw status seen: ${st}`);
    }
    if (typeof r.cost === 'number') {
      totalCost += r.cost;
      sawCost = true;
    }
  };

  for (const voice of VOICES) {
    const out = path.join(outDir, `${voice}.m4a`);
    if (existsSync(out)) {
      console.log(`${voice}: exists, skipping`);
      ok.push(voice);
      continue;
    }
    if (created >= cap) {
      console.log(`${voice}: SKIPPED (recording cap ${cap} reached)`);
      failed.push(voice);
      continue;
    }
    const tmpOut = `${out}.tmp`;
    const tmpIn = path.join(os.tmpdir(), `everthere-voice-${voice}-${Date.now()}.mp4`);
    try {
      created++;
      const rec = await n.createRecording(companionId, { provider: 'openAi', voiceId: voice, text: TEXT });
      note(rec);
      const deadline = Date.now() + MAX_MS;
      let status: unknown = rec.status;
      let state = classifyStatus(status);
      while (state !== 'done') {
        if (state === 'failed') throw new Error(`recording failed (status ${String(status)})`);
        if (Date.now() > deadline) throw new Error(`recording timed out (last status ${String(status)})`);
        await sleep(POLL_MS);
        const r = await n.getRecording(companionId, rec.id);
        note(r);
        status = r.status;
        state = classifyStatus(status);
      }
      const dl = await n.getRecordingDownloadUrl(companionId, rec.id);
      if (!dl?.url) throw new Error(`no url in download response (keys: ${Object.keys(dl ?? {}).join(',')})`);
      const res = await fetch(dl.url);
      if (!res.ok) throw new Error(`download ${res.status}`);
      writeFileSync(tmpIn, Buffer.from(await res.arrayBuffer()));
      const r = spawnSync(ffmpeg, ['-y', '-i', tmpIn, '-vn', '-c:a', 'aac', '-b:a', '80k', '-ac', '1', '-f', 'ipod', tmpOut], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`ffmpeg failed: ${(r.stderr ?? '').split('\n').slice(-6).join(' | ')}`);
      renameSync(tmpOut, out);
      console.log(`${voice}: ok`);
      ok.push(voice);
    } catch (e) {
      const msg = e instanceof NapsterError ? `${e.status} ${e.code}` : e instanceof Error ? e.message : String(e);
      console.log(`${voice}: FAILED (${msg})`);
      failed.push(voice);
      // Account-level refusals (recordings not enabled, no credits) won't change per voice: stop.
      if (e instanceof NapsterError && e.status === 403) {
        console.log(`Aborting: ${e.code} applies to every voice`);
        break;
      }
    } finally {
      removeQuietly(tmpIn);
      removeQuietly(tmpOut);
    }
  }
  console.log(`Recordings created: ${created}; cost reported: ${sawCost ? `$${totalCost.toFixed(4)}` : 'not provided by API'}`);
  console.log(`Succeeded: ${ok.join(', ') || '(none)'}`);
  console.log(`Failed: ${failed.join(', ') || '(none)'}`);
  if (failed.length) process.exitCode = 1;
}

if (process.argv[1]?.endsWith('voicePreviews.ts')) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
