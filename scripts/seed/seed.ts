// Seeds the demo world (Task 15; spec §7 "seeded demo world", §7a "Demo people", §8a "Judge access").
// Not run by tests. It runs at deploy time (Task 26), against the deployed Worker.
//
//   pnpm seed --dry-run      Print the plan and validate the fixture. No network, no env needed.
//   pnpm seed --faces-only   Generate portraits into scripts/seed/out/ (git-ignored), pick, pad, write the contact sheet.
//   pnpm seed                Faces -> Clerk users -> R2 upload -> Napster companions + agents -> PUT /api/admin/seed.
//   Extra flags: --repick (re-score candidates, ignoring picks.json), --regenerate (new candidates for every face).
//
// Env (repo-root .env):
//   META_API_KEY          portraits (muse-image-1.0) and automatic picks (muse-spark-1.3)
//   CLERK_SECRET_KEY      demo users (Backend API, skip_password_requirement: no password exists or is stored)
//   NAPSTER_API_KEY       one companion + agent per demo parent
//   MEDIA_SIGNING_KEY     the SAME value as the Worker secret: Napster fetches each portrait through a signed /m/ URL
//   API_BASE              deployed Worker origin, e.g. https://everthere-api.<account>.workers.dev
//   ADMIN_TOKEN           the Worker's ADMIN_TOKEN secret (X-Admin-Token for PUT /api/admin/seed)
//   NAPSTER_FLAG_FUNCTION_ID  optional; read from apps/api/wrangler.toml when unset
//
// R2 upload: `wrangler r2 object put everthere-media/<key> --remote` (run in apps/api). The API deliberately has no
// upload route for admin use, so the admin surface stays small. Needs `wrangler login` (or CLOUDFLARE_API_TOKEN).
// Order note: Clerk users are created before the R2 upload because avatar keys are avatar/<clerkUserId>/<id>.png.
//
// Resumable and idempotent: out/state.json keeps Clerk ids, R2 keys (and what was uploaded) and Napster ids, so a
// re-run reuses everything that exists and re-PUTs the fixture (PUT /api/admin/seed is idempotent).
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env'), quiet: true });
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { metaImages, type ImageSize } from '../../apps/api/src/meta/client';
import { napster as makeNapster } from '../../apps/api/src/napster/client';
import { agentProviderSettings, companionDescription, companionReadiness, firstNameOf } from '../../apps/api/src/services/avatars';
import { hmacHex } from '../../apps/api/src/lib/crypto';
import { buildAgentInstructions } from '../../packages/shared/src/prompt';
import { centerOnCanvas } from '../assets/imageOps';
import { ADULTS, CHILDREN, ORG, PERSONAS, SESSIONS, fullName, type AdultKey, type ChildKey } from './personas';
import { avatarId, buildFixture, familyIdOf, placeholderIds, randomInviteCodes, type SeedIds } from './fixture';
import { CLAY_CRITERIA, PHOTO_CRITERIA, contactSheetHtml, scoreAndPick, type SheetRow } from './pick';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const API_DIR = path.join(ROOT, 'apps/api');
const OUT = path.join(HERE, 'out');
const STATE_FILE = path.join(OUT, 'state.json');
const PICKS_FILE = path.join(OUT, 'picks.json');
const BUCKET = 'everthere-media';
const CANDIDATES = 4;
const NAPSTER_FRAME = { w: 1920, h: 1080 };
const NAPSTER_MAX_BYTES = 4_500_000; // Napster rejects pictures of 5 MB or more ("Image is too large"); keep headroom
const COMPANION_POLL_MS = 15_000;
const COMPANION_MAX_MS = 30 * 60_000;
const SIGNED_URL_TTL_MS = 2 * 3_600_000;

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const FACES_ONLY = args.has('--faces-only');

// ---- subjects --------------------------------------------------------------------------------------------------

type Subject = { key: string; label: string; prompt: string; size: ImageSize; criteria: string; kind: 'parent' | 'staff' | 'child' | 'logo' };

const SUBJECTS: Subject[] = [
  ...Object.values(ADULTS).map<Subject>((a) => ({
    key: a.key,
    label: `${fullName(a)}: ${a.role}`,
    prompt: a.portraitPrompt,
    size: a.avatar ? '1792x1024' : '1024x1024', // parents become 16:9 Napster companions
    criteria: PHOTO_CRITERIA,
    kind: a.avatar ? 'parent' : 'staff',
  })),
  ...CHILDREN.map<Subject>((c) => ({ key: c.key, label: `${c.name} (${c.rosterStatus})`, prompt: c.portraitPrompt, size: '1024x1024', criteria: CLAY_CRITERIA, kind: 'child' })),
  { key: 'logo', label: `${ORG.name} logo`, prompt: ORG.logoPrompt, size: '1024x1024', criteria: 'cheerful, clean, centered, no text', kind: 'logo' },
];

// ---- state -----------------------------------------------------------------------------------------------------

type State = {
  clerk: Partial<Record<AdultKey, string>>;
  profileImage: Partial<Record<AdultKey, boolean>>;
  keys: Record<string, string>; // subject key -> R2 key
  uploaded: Record<string, boolean>; // R2 key -> uploaded
  napster: Partial<Record<AdultKey, { companionId?: string; agentId?: string }>>;
};

const readJsonFile = <T>(file: string, fallback: T): T => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback);
const writeJsonFile = (file: string, v: unknown) => writeFileSync(file, JSON.stringify(v, null, 2) + '\n');
const loadState = (): State => ({ clerk: {}, profileImage: {}, keys: {}, uploaded: {}, napster: {}, ...readJsonFile<Partial<State>>(STATE_FILE, {}) });
const saveState = (s: State) => writeJsonFile(STATE_FILE, s);

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is missing from .env`);
  return v;
}

/** Same shape as the server's media keys: <purpose>/<ownerId>/<21 url-safe chars>.<ext>. */
const mediaKey = (purpose: 'avatar' | 'child' | 'logo', ownerId: string) => `${purpose}/${ownerId}/${randomBytes(16).toString('base64url').slice(0, 21)}.png`;

const finalFile = (key: string) => path.join(OUT, 'final', `${key}.png`);
const candidateFile = (key: string, n: number) => path.join(OUT, 'faces', key, `${n}.png`);

// ---- 1-2. faces: generate n:4, auto-pick with muse-spark, pad parents to 1920x1080, contact sheet ---------------

/** Downscales (keeping the aspect ratio) until the PNG fits Napster's picture size limit. */
async function underNapsterLimit(png: Buffer): Promise<Buffer> {
  let out = png;
  let w = NAPSTER_FRAME.w;
  while (out.length > NAPSTER_MAX_BYTES && w > 640) {
    w = Math.round(w * 0.9);
    out = await sharp(png).resize({ width: w }).png({ compressionLevel: 9 }).toBuffer();
  }
  return out;
}

async function faces(): Promise<void> {
  const metaKey = need('META_API_KEY');
  const images = metaImages(metaKey);
  const picks = args.has('--repick') ? {} : readJsonFile<Record<string, number>>(PICKS_FILE, {});
  const scores = readJsonFile<Record<string, number[] | null>>(path.join(OUT, 'scores.json'), {});
  mkdirSync(path.join(OUT, 'final'), { recursive: true });
  const rows: SheetRow[] = [];

  for (const s of SUBJECTS) {
    const dir = path.join(OUT, 'faces', s.key);
    mkdirSync(dir, { recursive: true });
    let have = [...Array(CANDIDATES).keys()].map((i) => i + 1).filter((n) => existsSync(candidateFile(s.key, n)));
    if (args.has('--regenerate') || have.length === 0) {
      console.log(`faces: generating ${CANDIDATES} candidates for ${s.key}`);
      const bufs = await images.generate({ prompt: s.prompt, n: CANDIDATES, size: s.size, outputFormat: 'png' });
      if (!bufs.length) throw new Error(`no images returned for ${s.key}`);
      bufs.forEach((b, i) => writeFileSync(candidateFile(s.key, i + 1), b));
      have = bufs.map((_, i) => i + 1);
      delete picks[s.key];
    }
    if (!picks[s.key] || !have.includes(picks[s.key]!)) {
      const r = await scoreAndPick(metaKey, have.map((n) => readFileSync(candidateFile(s.key, n))), s.criteria);
      picks[s.key] = have[r.pick - 1] ?? have[0]!;
      scores[s.key] = r.scores;
      console.log(`faces: ${s.key} -> candidate ${picks[s.key]}${r.scores ? ` (scores ${r.scores.join(', ')})` : ''}`);
    }
    const chosen = candidateFile(s.key, picks[s.key]!);
    const out = s.kind === 'parent' ? await underNapsterLimit(await centerOnCanvas(chosen, NAPSTER_FRAME.w, NAPSTER_FRAME.h)) : readFileSync(chosen);
    writeFileSync(finalFile(s.key), out);
    rows.push({ key: s.key, label: s.label, candidates: have.map((n) => `faces/${s.key}/${n}.png`), pick: picks[s.key]!, scores: scores[s.key] ?? null });
  }
  writeJsonFile(PICKS_FILE, picks);
  writeJsonFile(path.join(OUT, 'scores.json'), scores);
  writeFileSync(path.join(OUT, 'contact.html'), contactSheetHtml(rows));
  console.log(`faces: contact sheet at ${path.join(OUT, 'contact.html')}`);
}

// ---- 3. Clerk users (Backend API) ------------------------------------------------------------------------------

async function clerk<T>(method: string, p: string, body?: unknown | FormData): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(`https://api.clerk.com/v1${p}`, {
    method,
    headers: { Authorization: `Bearer ${need('CLERK_SECRET_KEY')}`, ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Clerk ${method} ${p} failed (${res.status}): ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

async function clerkUsers(state: State): Promise<void> {
  for (const a of Object.values(ADULTS)) {
    if (!state.clerk[a.key]) {
      const found = await clerk<{ id: string }[]>('GET', `/users?email_address=${encodeURIComponent(a.email)}`);
      state.clerk[a.key] =
        found[0]?.id ??
        (
          await clerk<{ id: string }>('POST', '/users', {
            email_address: [a.email],
            first_name: a.firstName,
            last_name: a.lastName,
            skip_password_requirement: true, // sign-in only through Worker-minted sign-in tokens; no password exists
          })
        ).id;
      saveState(state);
      console.log(`clerk: ${a.email} -> ${state.clerk[a.key]}`);
    }
    if (!state.profileImage[a.key] && existsSync(finalFile(a.key))) {
      const form = new FormData();
      form.append('file', new Blob([readFileSync(finalFile(a.key))], { type: 'image/png' }), `${a.key}.png`);
      try {
        await clerk('POST', `/users/${state.clerk[a.key]}/profile_image`, form);
        state.profileImage[a.key] = true;
        saveState(state);
      } catch (e) {
        console.warn(`clerk: profile image for ${a.key} failed (continuing):`, (e as Error).message);
      }
    }
  }
}

// ---- 4. R2 upload (wrangler) -----------------------------------------------------------------------------------

function r2Put(key: string, file: string): void {
  const r = spawnSync('pnpm', ['exec', 'wrangler', 'r2', 'object', 'put', `"${BUCKET}/${key}"`, '--file', `"${file}"`, '--content-type', 'image/png', '--remote'], {
    cwd: API_DIR,
    shell: true, // pnpm is a .cmd shim on Windows
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error(`wrangler r2 object put ${key} failed (exit ${r.status})`);
}

function uploads(state: State): void {
  const want: [string, () => string][] = [
    ...Object.values(ADULTS).filter((a) => a.avatar).map((a) => [a.key, () => mediaKey('avatar', state.clerk[a.key]!)] as [string, () => string]),
    ...CHILDREN.filter((c) => c.rosterStatus !== 'invite_sent').map((c) => [c.key, () => mediaKey('child', familyIdOf(c))] as [string, () => string]),
    ['logo', () => mediaKey('logo', ORG.id)],
  ];
  for (const [subject, makeKey] of want) {
    state.keys[subject] ??= makeKey();
    const key = state.keys[subject]!;
    if (state.uploaded[key]) continue;
    console.log(`r2: ${subject} -> ${key}`);
    r2Put(key, finalFile(subject));
    state.uploaded[key] = true;
    saveState(state);
  }
}

// ---- 5. Napster companions + agents ----------------------------------------------------------------------------

async function signedUrl(key: string): Promise<string> {
  const exp = Date.now() + SIGNED_URL_TTL_MS;
  const sig = await hmacHex(need('MEDIA_SIGNING_KEY'), `${key}|${exp}`);
  return `${need('API_BASE').replace(/\/+$/, '')}/m/${encodeURIComponent(key)}?exp=${exp}&sig=${sig}`;
}

function flagFunctionId(): string {
  const fromEnv = process.env.NAPSTER_FLAG_FUNCTION_ID?.trim();
  if (fromEnv) return fromEnv;
  const m = /^NAPSTER_FLAG_FUNCTION_ID\s*=\s*"(.*)"/m.exec(readFileSync(path.join(API_DIR, 'wrangler.toml'), 'utf8'));
  const id = m?.[1] ?? '';
  if (!id || id === 'flag_concern') console.warn('napster: NAPSTER_FLAG_FUNCTION_ID looks unset; run `pnpm napster:flag-tool` first');
  return id;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function napsterAvatars(state: State): Promise<void> {
  const n = makeNapster(need('NAPSTER_API_KEY'));
  const flagId = flagFunctionId();
  for (const a of Object.values(ADULTS)) {
    if (!a.avatar) continue;
    const rec = (state.napster[a.key] ??= {});
    if (rec.agentId) continue;
    const title = a.avatar.parentTitle;
    if (!rec.companionId) {
      const pictureUrl = await signedUrl(state.keys[a.key]!);
      rec.companionId = (await n.createCompanion({ description: companionDescription(a.firstName, title), firstName: a.firstName, pictureUrl, version: 'v1' })).id;
      saveState(state);
      console.log(`napster: companion for ${a.key} -> ${rec.companionId}`);
    }
    const started = Date.now();
    for (;;) {
      const readiness = companionReadiness(await n.getCompanion(rec.companionId));
      if (readiness === 'ready') break;
      if (readiness === 'failed') throw new Error(`napster: companion ${rec.companionId} for ${a.key} failed; delete it from state.json to retry`);
      if (Date.now() - started > COMPANION_MAX_MS) throw new Error(`napster: companion ${rec.companionId} for ${a.key} still not ready after 30 min`);
      console.log(`napster: waiting for ${a.key}'s companion...`);
      await sleep(COMPANION_POLL_MS);
    }
    rec.agentId = (
      await n.createAgent({
        companionId: rec.companionId,
        name: `everthere-${avatarId(a.key)}-${rec.companionId.slice(-6)}`,
        voiceId: a.avatar.voiceId,
        language: 'en',
        mode: 'conversation',
        providerSettings: agentProviderSettings(buildAgentInstructions(firstNameOf(fullName(a)), title)),
        functions: flagId ? [flagId] : [],
      })
    ).id;
    saveState(state);
    console.log(`napster: agent for ${a.key} -> ${rec.agentId}`);
  }
}

// ---- 6-8. fixture + PUT /api/admin/seed ------------------------------------------------------------------------

function idsFrom(state: State): SeedIds {
  const users = {} as Record<AdultKey, string>;
  for (const a of Object.values(ADULTS)) users[a.key] = state.clerk[a.key]!;
  const avatars: SeedIds['avatars'] = {};
  for (const a of Object.values(ADULTS)) {
    const rec = state.napster[a.key];
    if (a.avatar && rec?.companionId && rec.agentId) avatars[a.key] = { companionId: rec.companionId, agentId: rec.agentId, photoKey: state.keys[a.key] ?? null };
  }
  const childPhotos: SeedIds['childPhotos'] = {};
  for (const c of CHILDREN) if (state.keys[c.key]) childPhotos[c.key as ChildKey] = state.keys[c.key];
  // Fresh random invite codes every run (the API refuses a code that already exists outside the demo world).
  return { users, avatars, childPhotos, logoKey: state.keys.logo ?? null, inviteCodes: randomInviteCodes() };
}

async function putSeed(fixture: unknown): Promise<void> {
  const res = await fetch(`${need('API_BASE').replace(/\/+$/, '')}/api/admin/seed`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': need('ADMIN_TOKEN') },
    body: JSON.stringify(fixture),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PUT /api/admin/seed failed (${res.status}): ${text.slice(0, 500)}`);
  console.log(`seed: ${text}`);
}

// ---- dry run ---------------------------------------------------------------------------------------------------

function dryRun(): void {
  const f = buildFixture(placeholderIds(), Date.now());
  const line = (s: string) => console.log(s);
  line('DRY RUN: nothing is generated, created or uploaded.\n');
  line(`1-2. Faces: ${SUBJECTS.length} subjects x ${CANDIDATES} candidates (muse-image-1.0), auto-picked by ${'muse-spark'}; parents padded to ${NAPSTER_FRAME.w}x${NAPSTER_FRAME.h}.`);
  for (const s of SUBJECTS) line(`     - ${s.key.padEnd(7)} ${s.kind.padEnd(6)} ${s.size}  ${s.label}`);
  line(`\n3. Clerk users (skip_password_requirement, no password stored); "Try the demo": parent=${PERSONAS.parent}, teacher=${PERSONAS.teacher}`);
  for (const a of Object.values(ADULTS)) line(`     - ${fullName(a).padEnd(15)} ${a.email}`);
  line(`\n4. R2 (${BUCKET}, via wrangler --remote): ${Object.values(ADULTS).filter((a) => a.avatar).length} avatar photos, ${f.children.length} child photos, 1 logo.`);
  line('\n5. Napster companions + agents (is_synthetic, consent "AI-generated face, no real person"):');
  for (const a of Object.values(ADULTS)) if (a.avatar) line(`     - ${fullName(a)} as "${a.avatar.parentTitle}", voice ${a.avatar.voiceId}`);
  line(`\n6-7. Fixture: ${f.users.length} users, ${f.orgs.length} org, ${f.classrooms.length} classroom, ${f.families.length} families, ${f.children.length} children, ` +
    `${f.enrollments.length} enrollments, ${f.plans.length} plans, ${f.connections.length} connections, ${f.sessions.length} sessions, ${f.flags.length} flag, ${f.alerts.length} alerts.`);
  line('     Roster (Butterflies Room):');
  for (const c of CHILDREN) line(`     - ${c.name.padEnd(5)} ${c.rosterStatus}`);
  line('     Past sessions:');
  for (const s of SESSIONS) line(`     - ${s.key} ${s.child}/${s.parent} via ${s.caregiver}, ${s.reason}, ${s.daysAgo}d ago ${s.localTime}${s.flag ? `  FLAG: "${s.flag.quote}"` : ''}`);
  line(`\n8. PUT ${process.env.API_BASE?.trim() || '<API_BASE>'}/api/admin/seed (fixture validated against the API schema: OK)`);
}

// ---- main ------------------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  if (DRY) return dryRun();
  mkdirSync(OUT, { recursive: true });
  await faces();
  if (FACES_ONLY) return;
  const state = loadState();
  await clerkUsers(state);
  uploads(state);
  await napsterAvatars(state);
  const fixture = buildFixture(idsFrom(state), Date.now());
  writeJsonFile(path.join(OUT, 'fixture.json'), fixture);
  await putSeed(fixture);
  console.log('seed: done. Show the contact sheet (scripts/seed/out/contact.html) to the user.');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
