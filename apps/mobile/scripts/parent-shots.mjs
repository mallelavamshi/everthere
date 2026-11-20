// Starts the Vite dev server in-process and screenshots the parent screens at 390x844 with the API mocked by route
// interception (the DEV-only /parent/* preview supplies a fake signed-in parent). Usage: node scripts/parent-shots.mjs [outDir]
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(process.argv[2] ?? '../../docs/notes/ui');
mkdirSync(outDir, { recursive: true });

const server = await createServer({ server: { port: 5198, strictPort: true }, logLevel: 'error' });
await server.listen();
const base = 'http://localhost:5198';
const launch = (args = []) => chromium.launch({ ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}), args });

const photo = `${base}/src/assets/img/brand.icon.webp`;
// Stand-in for a signed child photo URL: a committed illustration served by the dev server.
const childPhoto = `${base}/src/assets/img/moment.feltBetter.webp`;
const mia = { id: 'c1', name: 'Mia', photoKey: null, photoUrl: childPhoto, familyId: 'f1', birthday: '2022-03-02', timezone: 'America/New_York' };
const withCoParent = { ...mia, familyAvatars: [
  { avatarId: 'av1', ownerUserId: 'u1', ownerName: 'Sarah Lee', parentTitle: 'Mom', status: 'approved', isMine: true },
  { avatarId: 'av2', ownerUserId: 'u2', ownerName: 'Dan Lee', parentTitle: 'Dad', status: 'creating', isMine: false },
] };
const avatar = (over = {}) => ({
  id: 'av1', status: 'approved', voiceId: 'coral', photoKey: 'avatar/u/1.jpg', photoUrl: photo, parentTitle: 'Mom',
  consentName: 'Sarah Lee', consentAt: 1, approvedAt: 2, createdAt: 1, hasAgent: true, ...over,
});
const session = {
  id: 's1', child: { id: 'c1', name: 'Mia' }, caregiverName: 'Ms. Jess', reason: 'upset_nap', startedAt: new Date().setHours(11, 20, 0, 0),
  durationS: 240, moodAfter: 'calmer', summary: 'You talked about Bunny\'s picnic and she smiled.', moodSignal: null, flags: [],
};

/** data: { children, avatars (a list, or a function for stateful flows), sessions, note } */
async function mock(page, data) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^.*\/api/, '');
    const method = route.request().method();
    const ok = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/children') return ok({ children: data.children });
    if (/^\/children\/[^/]+\/plans\//.test(p)) return ok({ todayNote: data.note ?? null, todayNoteExpiresAt: null });
    if (p === '/sessions') return ok({ items: data.sessions ?? [], nextCursor: null });
    if (p === '/avatars/mine') return ok(data.avatars);
    if (/^\/avatars\/[^/]+$/.test(p) && method === 'GET') return ok(data.avatars[0] ?? avatar());
    if (p === '/media') return ok({ key: 'avatar/u/new.jpg', url: photo });
    if (p === '/avatars' && method === 'POST') return ok(avatar({ status: 'creating', approvedAt: null }));
    return ok({});
  });
}

const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const errors = [];
const watch = (page, name) => {
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  page.on('console', (m) => m.type() === 'error' && !/Clerk|clerk|Failed to load resource|getUserMedia|NotFound/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
};

async function open(browser, name, data, path, { fakeCamera = false, hour } = {}) {
  const ctx = await browser.newContext({ ...phone, ...(fakeCamera ? { permissions: ['camera'] } : {}) });
  await ctx.addInitScript(() => localStorage.setItem('everthere.devPreview', 'parent'));
  if (hour !== undefined) {
    await ctx.addInitScript((h) => {
      const R = Date;
      const fixed = new R();
      fixed.setHours(h, 30, 0, 0);
      const offset = fixed.getTime() - R.now();
      // eslint-disable-next-line no-global-assign
      Date = class extends R {
        constructor(...a) {
          if (a.length === 0) super(R.now() + offset);
          else super(...a);
        }
        static now() {
          return R.now() + offset;
        }
      };
    }, hour);
  }
  const page = await ctx.newPage();
  watch(page, name);
  await mock(page, data);
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page };
}

const shot = async (page, name, wait = 700) => {
  await page.waitForTimeout(wait);
  const file = `${outDir}/parent-${name}.png`;
  await page.screenshot({ path: file });
  console.log('shot', file);
};

const full = { children: [withCoParent], avatars: [avatar()], sessions: [session], note: 'Grandma picks up at 4' };

const browser = await launch();
const camBrowser = await launch(['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']);
try {
  // warm-up: Vite's first visit optimises dependencies and reloads
  {
    const { ctx, page } = await open(browser, 'warm', full, '/parent');
    await page.getByText('Mia', { exact: true }).first().waitFor({ timeout: 40000 });
    await ctx.close();
  }

  // 1-3 ParentHome
  for (const [name, data, text, hour] of [
    ['1-home-data', full, 'Grandma picks up at 4', 9],
    ['2-home-empty', { children: [], avatars: [] }, 'Add your child', 14],
    ['3-home-no-avatar', { children: [mia], avatars: [], sessions: [] }, 'Create your avatar', 9],
  ]) {
    const { ctx, page } = await open(browser, name, data, '/parent', { hour });
    await page.getByText(text).first().waitFor({ timeout: 15000 });
    await shot(page, name, 1000);
    await ctx.close();
  }

  // 4 PhotoStep: fallback (no camera device in headless) and live (fake camera)
  {
    const { ctx, page } = await open(browser, 'photo', { children: [mia], avatars: [] }, '/parent/avatar/setup/photo');
    await page.getByRole('button', { name: 'Open the camera' }).waitFor({ timeout: 15000 });
    await shot(page, '4-photo-fallback');
    await ctx.close();
  }
  {
    const { ctx, page } = await open(camBrowser, 'photo-live', { children: [mia], avatars: [] }, '/parent/avatar/setup/photo', { fakeCamera: true });
    await page.getByRole('button', { name: 'Take photo' }).waitFor({ timeout: 15000 });
    await page.getByRole('status').first().waitFor({ timeout: 5000 }).catch(() => {});
    await shot(page, '4b-photo-live', 1200);

    // on through the flow with the fake camera: shutter -> preview -> voice -> consent
    await page.getByRole('button', { name: 'Take photo' }).click();
    await page.getByRole('button', { name: 'Use this' }).waitFor();
    await shot(page, '4c-photo-preview', 300);
    await page.getByRole('button', { name: 'Use this' }).click();
    await page.getByRole('radio', { name: /Coral/ }).waitFor();
    await shot(page, '5-voice-step', 500);
    await page.getByRole('radio', { name: /Coral/ }).click();
    await shot(page, '5b-voice-picked', 400);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel(/full legal name/i).fill('Sarah Lee');
    await page.getByRole('checkbox').check({ force: true });
    await shot(page, '6-consent-step', 500);
    await page.getByRole('button', { name: /Create my avatar/ }).click();
    await page.waitForURL(/creating/);
    await ctx.close();
  }

  // 7 Creating
  {
    const { ctx, page } = await open(browser, 'creating', { children: [mia], avatars: [avatar({ status: 'creating' })] }, '/parent/avatar/creating/av1');
    await page.getByText('Making your avatar').waitFor({ timeout: 15000 });
    await shot(page, '7-creating', 4200);
    await ctx.close();
  }

  // 8 TestAndApprove: the "How did that feel?" result (the live call itself returns here with route state)
  {
    const { ctx, page } = await open(browser, 'test', { children: [mia], avatars: [avatar({ status: 'ready', approvedAt: null })] }, '/parent/avatar/test/av1');
    await page.getByRole('button', { name: /Start test call/ }).waitFor({ timeout: 15000 });
    await shot(page, '8a-test-intro');
    await page.evaluate(() => history.replaceState({ usr: { endedSessionId: 's1' }, key: 'k1', idx: 0 }, '', location.href));
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText('How did that feel?').waitFor({ timeout: 15000 });
    await shot(page, '8b-test-result');
    await page.getByRole('button', { name: /Approve my avatar/ }).click();
    await page.getByText('Your avatar is approved!').waitFor();
    await shot(page, '8c-approved', 500);
    await ctx.close();
  }

  // 9 MyAvatar
  {
    const { ctx, page } = await open(browser, 'myavatar', full, '/parent/avatar');
    await page.getByText('Bright & cheerful').waitFor({ timeout: 15000 });
    await shot(page, '9-my-avatar');
    await page.getByRole('button', { name: /Change photo/ }).click();
    await shot(page, '9b-my-avatar-warning', 700);
    await ctx.close();
  }

  // Sessions and Caregivers tabs
  for (const [name, path, text] of [
    ['10-sessions', '/parent/sessions', 'felt better'],
    ['11-caregivers', '/parent/caregivers', 'Your village'],
  ]) {
    const { ctx, page } = await open(browser, name, full, path);
    await page.getByText(text).first().waitFor({ timeout: 15000 });
    await shot(page, name);
    await ctx.close();
  }
} finally {
  await browser.close();
  await camBrowser.close();
  await server.close();
}
if (errors.length) {
  console.error('page errors:\n' + errors.join('\n'));
  process.exit(1);
}
