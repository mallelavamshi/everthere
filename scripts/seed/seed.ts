// Seeds the demo world (Task 15; spec §7 "seeded demo world", §7a "Demo people", §8a "Judge access").
// Not run by tests. It runs at deploy time (Task 26), against the deployed Worker.
//
//   pnpm seed --dry-run      Print the plan and validate the fixture. No network, no env needed.
//   pnpm seed --faces-only   Generate portraits into scripts/seed/out/ (git-ignored), pick, pad, write the contact sheet.
//   pnpm seed                Faces -> Clerk users -> R2 upload -> Napster companions + agents -> PUT /api/admin/seed.
//   Extra flags: --repick (re-score candidates, ignoring picks.json), --regenerate (new candidates for every face).
//   pnpm seed --plan             Read out/state.json and print what a run would create, upload or update. No network.
//   pnpm seed --only marcus      Targeted run for the named adult(s) (comma-separated): no faces step; Clerk, photo,
//                                R2 and Napster steps for those adults only; then the full fixture is rebuilt from
//                                state and PUT. Other parents' companions, agents and uploads are never touched.
//   Combine them (`--plan --only marcus`) to see exactly what the targeted run will do.
//
// A parent whose persona names an existing Napster companion (avatar.companionId, e.g. the user's own avatar as Mia's
// Daddy) gets no companion created and no AI face: the seed makes only an agent on that companion, and the app photo
// is the companion's preview image (downloaded, converted to PNG, uploaded under a new avatar/<clerkUserId>/ key).
// A state record pointing at an earlier companion is moved to state.retired; nothing is deleted anywhere.
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
import { hmacHex } from '../../apps/api/src/lib/crypto';
import { centerOnCanvas } from '../assets/imageOps';
import { ADULTS, CHILDREN, ORG, PERSONAS, SESSIONS, fullName, type Adult, type AdultKey, type ChildKey } from './personas';
import { buildFixture, familyIdOf, inviteCodesOf, placeholderIds, randomInviteCodes, type SeedIds } from './fixture';
import { CLAY_CRITERIA, PHOTO_CRITERIA, contactSheetHtml, scoreAndPick, type SheetRow } from './pick';
import { NAPSTER_MAX_BYTES, clerkNamePatch, ensureNapsterAvatar, napsterPlan, needsCompanionPhoto, previewUrlOf, toAvatarPng, type NapsterRec } from './napsterAvatar';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const API_DIR = path.join(ROOT, 'apps/api');
const OUT = path.join(HERE, 'out');
const STATE_FILE = path.join(OUT, 'state.json');
const PICKS_FILE = path.join(OUT, 'picks.json');
const BUCKET = 'everthere-media';
const CANDIDATES = 4;
const NAPSTER_FRAME = { w: 1920, h: 1080 };
const SIGNED_URL_TTL_MS = 2 * 3_600_000;

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const FACES_ONLY = args.has('--faces-only');
const PLAN = args.has('--plan');

/** `--only a,b` (or `--only=a,b`): the adults a targeted run touches; null means everyone. */
function onlyAdults(): Adult[] | null {
  const argv = process.argv.slice(2);
  const i = argv.findIndex((x) => x === '--only' || x.startsWith('--only='));
  if (i < 0) return null;
  const raw = argv[i]!.includes('=') ? argv[i]!.split('=')[1]! : (argv[i + 1] ?? '');
  const keys = raw.split(',').map((k) => k.trim()).filter(Boolean);
  if (!keys.length) throw new Error('--only needs a persona key, e.g. --only marcus');
  return keys.map((k) => {
    const a = ADULTS[k as AdultKey];
    if (!a) throw new Error(`--only: unknown persona key "${k}" (known: ${Object.keys(ADULTS).join(', ')})`);
    return a;
  });
}
const ONLY = onlyAdults();
const SELECTED: Adult[] = ONLY ?? Object.values(ADULTS);

// ---- subjects --------------------------------------------------------------------------------------------------

type Subject = { key: string; label: string; prompt: string; size: ImageSize; criteria: string; kind: 'parent' | 'staff' | 'child' | 'logo' };

const SUBJECTS: Subject[] = [
  // Adults whose face is an existing Napster companion have no prompt and no AI portrait.
  ...Object.values(ADULTS).filter((a) => a.portraitPrompt).map<Subject>((a) => ({
    key: a.key,
    label: `${fullName(a)}: ${a.role}`,
    prompt: a.portraitPrompt!,
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
  napster: Partial<Record<AdultKey, NapsterRec>>;
  /** Preset companion id each companion-backed adult's current photo key was made from. */
  photoFrom: Partial<Record<AdultKey, string>>;
  /** Napster records superseded by a preset companion. Kept for reference only; never deleted anywhere. */
  retired: { key: AdultKey; companionId?: string; agentId?: string; at: string }[];
};

const readJsonFile = <T>(file: string, fallback: T): T => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback);
const writeJsonFile = (file: string, v: unknown) => writeFileSync(file, JSON.stringify(v, null, 2) + '\n');
const loadState = (): State => ({
  clerk: {}, profileImage: {}, keys: {}, uploaded: {}, napster: {}, photoFrom: {}, retired: [],
  ...readJsonFile<Partial<State>>(STATE_FILE, {}),
});
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
  for (const a of SELECTED) {
    if (state.clerk[a.key]) {
      // Existing user: only the displayed name is kept in step with the persona (never a new user for a rename).
      const user = await clerk<{ first_name?: string | null; last_name?: string | null }>('GET', `/users/${state.clerk[a.key]}`);
      const patch = clerkNamePatch(a, user);
      if (patch) {
        await clerk('PATCH', `/users/${state.clerk[a.key]}`, patch);
        console.log(`clerk: ${a.key} renamed to ${patch.first_name} ${patch.last_name}`);
      }
    }
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
    if (a.portraitPrompt && !state.profileImage[a.key] && existsSync(finalFile(a.key))) {
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

/** Subject -> key maker for every R2 object this run may upload (a targeted run: only its adults' avatar photos). */
function uploadList(state: State): [string, () => string][] {
  return [
    ...SELECTED.filter((a) => a.avatar).map((a) => [a.key, () => mediaKey('avatar', state.clerk[a.key]!)] as [string, () => string]),
    ...(ONLY ? [] : CHILDREN.filter((c) => c.rosterStatus !== 'invite_sent').map((c) => [c.key, () => mediaKey('child', familyIdOf(c))] as [string, () => string])),
    ...(ONLY ? [] : [['logo', () => mediaKey('logo', ORG.id)] as [string, () => string]]),
  ];
}

/**
 * A preset companion's preview image becomes the parent's app photo: downloaded, converted to PNG (and downscaled if
 * needed), written as the subject's final file and given a NEW avatar/<clerkUserId>/ key, which uploads() then puts
 * in R2. The previous key's object stays in R2 (only no longer referenced).
 */
async function companionPhotos(state: State): Promise<void> {
  const n = makeNapster(need('NAPSTER_API_KEY'));
  for (const a of SELECTED) {
    if (!needsCompanionPhoto(a, state.photoFrom[a.key])) continue;
    const companionId = a.avatar!.companionId!;
    const url = previewUrlOf(await n.getCompanion(companionId));
    const res = await fetch(url);
    if (!res.ok) throw new Error(`photo: preview of companion ${companionId} failed (${res.status})`);
    const png = await toAvatarPng(Buffer.from(await res.arrayBuffer()));
    mkdirSync(path.join(OUT, 'final'), { recursive: true });
    writeFileSync(finalFile(a.key), png);
    const key = mediaKey('avatar', state.clerk[a.key]!);
    const meta = await sharp(png).metadata();
    console.log(`photo: ${a.key} <- companion ${companionId} preview (${meta.width}x${meta.height}, ${png.length} bytes) -> ${key}`);
    state.keys[a.key] = key;
    state.photoFrom[a.key] = companionId;
    saveState(state);
  }
}

function uploads(state: State): void {
  const want = uploadList(state);
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

async function napsterAvatars(state: State): Promise<void> {
  const n = makeNapster(need('NAPSTER_API_KEY'));
  const flagId = flagFunctionId();
  for (const a of SELECTED) {
    const plan = napsterPlan(a, state.napster[a.key]);
    if (plan === 'none' || plan === 'keep') continue;
    const { rec, replaced } = await ensureNapsterAvatar(a, state.napster[a.key], {
      napster: n,
      pictureUrl: () => signedUrl(state.keys[a.key]!),
      flagFunctionId: flagId,
      save: (r) => {
        state.napster[a.key] = { ...r };
        saveState(state);
      },
      log: (m) => console.log(m),
    });
    if (replaced) {
      state.retired.push({ key: a.key, ...replaced, at: new Date().toISOString() });
      console.log(
        `napster: ${a.key} now uses preset companion ${rec.companionId}; previous companion ${replaced.companionId ?? '-'} / ` +
          `agent ${replaced.agentId ?? '-'} kept in Napster, no longer referenced`,
      );
    }
    state.napster[a.key] = rec;
    saveState(state);
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
  // Fresh random invite codes every full run (the API refuses a code that already exists outside the demo world). A
  // targeted run keeps the codes of the fixture it last PUT (out/fixture.json), so the push leaves the invites as they are.
  const kept = ONLY ? inviteCodesOf(readJsonFile<Parameters<typeof inviteCodesOf>[0]>(path.join(OUT, 'fixture.json'), null)) : null;
  if (ONLY) console.log(kept ? 'seed: keeping the invite codes of the last pushed fixture' : 'seed: no complete earlier fixture; drawing fresh invite codes');
  return { users, avatars, childPhotos, logoKey: state.keys.logo ?? null, inviteCodes: kept ?? randomInviteCodes() };
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
  for (const a of Object.values(ADULTS)) {
    if (!a.avatar) continue;
    const from = a.avatar.companionId ? `existing companion ${a.avatar.companionId} (agent only; photo = its preview)` : 'new companion from the portrait';
    line(`     - ${fullName(a)} as "${a.avatar.parentTitle}", voice ${a.avatar.voiceId}, ${from}`);
  }
  line(`\n6-7. Fixture: ${f.users.length} users, ${f.orgs.length} org, ${f.classrooms.length} classroom, ${f.families.length} families, ${f.children.length} children, ` +
    `${f.enrollments.length} enrollments, ${f.plans.length} plans, ${f.connections.length} connections, ${f.sessions.length} sessions, ${f.flags.length} flag, ${f.alerts.length} alerts.`);
  line('     Roster (Butterflies Room):');
  for (const c of CHILDREN) line(`     - ${c.name.padEnd(5)} ${c.rosterStatus}`);
  line('     Past sessions:');
  for (const s of SESSIONS) line(`     - ${s.key} ${s.child}/${s.parent} via ${s.caregiver}, ${s.reason}, ${s.daysAgo}d ago ${s.localTime}${s.flag ? `  FLAG: "${s.flag.quote}"` : ''}`);
  line(`\n8. PUT ${process.env.API_BASE?.trim() || '<API_BASE>'}/api/admin/seed (fixture validated against the API schema: OK)`);
}

// ---- plan (reads state.json, no network) ------------------------------------------------------------------------

function planRun(): void {
  const state = loadState();
  const line = (s: string) => console.log(s);
  line(`PLAN${ONLY ? ` (--only ${ONLY.map((a) => a.key).join(',')})` : ''}: from ${path.relative(ROOT, STATE_FILE)}. Nothing is called or changed.\n`);
  line(ONLY ? '1-2. Faces: skipped (targeted run).' : `1-2. Faces: ${SUBJECTS.length} subjects (local candidates reused; Meta only for subjects with none).`);
  line('3. Clerk:');
  for (const a of SELECTED) {
    line(`     - ${a.key.padEnd(7)} ${state.clerk[a.key] ? `existing ${state.clerk[a.key]}: GET, and PATCH the name if it is not "${fullName(a)}"` : `CREATE ${a.email} (${fullName(a)})`}`);
  }
  line('   Photos from preset companions:');
  for (const a of SELECTED.filter((x) => x.avatar?.companionId)) {
    line(`     - ${a.key.padEnd(7)} ${needsCompanionPhoto(a, state.photoFrom[a.key]) ? `DOWNLOAD preview of ${a.avatar!.companionId} -> new avatar/${state.clerk[a.key] ?? '<clerk id>'}/<id>.png` : `keep ${state.keys[a.key]}`}`);
  }
  line('4. R2:');
  for (const [subject] of uploadList(state)) {
    const preset = ADULTS[subject as AdultKey];
    const key = preset && needsCompanionPhoto(preset, state.photoFrom[preset.key]) ? undefined : state.keys[subject];
    line(`     - ${subject.padEnd(7)} ${key && state.uploaded[key] ? `keep ${key}` : `UPLOAD ${key ?? '(new key)'}`}`);
  }
  line('5. Napster:');
  for (const a of SELECTED.filter((x) => x.avatar)) {
    const rec = state.napster[a.key];
    const p = napsterPlan(a, rec);
    const what =
      p === 'keep' ? `keep companion ${rec!.companionId} / agent ${rec!.agentId}` :
      p === 'agent' ? `CREATE AGENT on companion ${a.avatar!.companionId ?? rec!.companionId}` +
        (a.avatar!.companionId && rec?.companionId && rec.companionId !== a.avatar!.companionId ? ` (retire ${rec.companionId} / ${rec.agentId ?? '-'} in state only)` : '') :
      'CREATE COMPANION + AGENT';
    line(`     - ${a.key.padEnd(7)} ${what}`);
  }
  line(`6-8. Rebuild the full fixture from state and PUT ${process.env.API_BASE?.trim() || '<API_BASE>'}/api/admin/seed.`);
}

// ---- main ------------------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  if (DRY) return dryRun();
  if (PLAN) return planRun();
  mkdirSync(OUT, { recursive: true });
  if (!ONLY) await faces();
  if (FACES_ONLY) return;
  const state = loadState();
  await clerkUsers(state);
  await companionPhotos(state);
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
