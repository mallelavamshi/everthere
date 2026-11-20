// Starts the Vite dev server in-process and screenshots the comfort plan and Today note at 390x844 with the API mocked by
// route interception (the DEV-only /parent/* preview supplies a fake signed-in parent).
// Usage: node scripts/plan-shots.mjs [outDir]
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(process.argv[2] ?? '../../docs/notes/ui');
mkdirSync(outDir, { recursive: true });

const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const base = 'http://localhost:5199';
const browser = await chromium.launch({ ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) });

const photo = `${base}/src/assets/img/brand.icon.webp`;
const mia = {
  id: 'c1', name: 'Mia', photoKey: null, photoUrl: `${base}/src/assets/img/moment.feltBetter.webp`, familyId: 'f1', birthday: '2022-03-02', timezone: 'America/New_York',
  familyAvatars: [{ avatarId: 'av1', ownerUserId: 'dev_parent', ownerName: 'Sarah Lee', parentTitle: 'Mommy', status: 'approved', isMine: true }],
};
const avatar = {
  id: 'av1', status: 'approved', voiceId: 'coral', photoKey: 'avatar/u/1.jpg', photoUrl: photo, parentTitle: 'Mommy',
  consentName: 'Sarah Lee', consentAt: 1, approvedAt: 2, createdAt: 1, hasAgent: true,
};
const plan = (over = {}) => ({
  childId: 'c1', avatarId: 'av1', parentTitle: 'Mommy', tone: 'playful', nicknames: [], favorites: [], phrases: [], songTitle: null,
  songLyrics: null, neverTopics: [], todayNote: null, todayNoteExpiresAt: null, ...over,
});
const filled = plan({
  nicknames: ['Sunshine', 'Mia-bear'], favorites: ['Bunny', 'Dinos', 'Trucks'], phrases: ["I'm right here", 'Deep breaths'],
  songTitle: 'Twinkle Twinkle', songLyrics: 'Twinkle, twinkle, little star,\nHow I wonder what you are.', neverTopics: ["Grandpa's hospital stay"], todayNote: 'Grandma picks up today',
});

async function open(name, current, path) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => localStorage.setItem('everthere.devPreview', 'parent'));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  page.on('console', (m) => m.type() === 'error' && !/Clerk|clerk|Failed to load resource|NotFound/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    const ok = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/children') return ok({ children: [mia] });
    if (/^\/children\/[^/]+\/plans\//.test(p)) {
      if (route.request().method() === 'PUT') return ok({ ...current, ...JSON.parse(route.request().postData() ?? '{}') });
      return ok(current);
    }
    if (p === '/avatars/mine') return ok([avatar]);
    if (p === '/sessions') return ok({ items: [], nextCursor: null });
    return ok({});
  });
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page };
}
const errors = [];
const shot = async (page, name, wait = 700) => {
  await page.waitForTimeout(wait);
  const file = `${outDir}/plan-${name}.png`;
  await page.screenshot({ path: file });
  console.log('shot', file);
};
const scrollBottom = (page) => page.evaluate(() => document.querySelector('main')?.scrollTo(0, 99999));
const box = (page, label) => page.getByRole('textbox', { name: label });
const url = '/parent/children/c1/plan/av1';

try {
  // warm-up: Vite's first visit optimises dependencies and reloads
  {
    const { ctx, page } = await open('warm', filled, '/parent');
    await page.getByText('Mia', { exact: true }).first().waitFor({ timeout: 40000 });
    await ctx.close();
  }

  // 1 filled, top and bottom
  {
    const { ctx, page } = await open('filled', filled, url);
    await page.getByText('How do you comfort Mia?').waitFor({ timeout: 15000 });
    await shot(page, '1-filled');
    await scrollBottom(page);
    await shot(page, '1b-filled-bottom', 300);
    await ctx.close();
  }

  // 2 empty / default, top and bottom
  {
    const { ctx, page } = await open('empty', plan(), url);
    await page.getByText('How do you comfort Mia?').waitFor({ timeout: 15000 });
    await shot(page, '2-empty');
    await scrollBottom(page);
    await shot(page, '2b-empty-bottom', 300);
    await ctx.close();
  }

  // 3 chip limit reached
  {
    const { ctx, page } = await open('limit', plan({ favorites: ['Bunny', 'Dinos'] }), url);
    await page.getByText('How do you comfort Mia?').waitFor({ timeout: 15000 });
    const input = box(page, 'Add to Favorite things');
    for (const w of ['Trucks', 'Princesses', 'Bubbles', 'Puppies', 'Trains', 'Painting', 'Rainbows', 'Blocks', 'Cuddles', 'Frogs']) {
      await input.fill(w);
      await input.press('Enter');
    }
    await page.getByText("That's plenty!").waitFor();
    await input.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.querySelector('main')?.scrollBy(0, 120));
    await shot(page, '3-chip-limit', 400);
    await ctx.close();
  }

  // 4 Today note sheet
  {
    const { ctx, page } = await open('note', plan(), '/parent');
    await page.getByRole('button', { name: 'Add a note for today' }).click();
    await page.getByRole('dialog', { name: 'Add a note for today' }).waitFor();
    await page.getByRole('button', { name: 'Grandma picks up today' }).click();
    await shot(page, '4-today-note', 800);
    await ctx.close();
  }

  // 5 unsaved changes sheet
  {
    const { ctx, page } = await open('leave', filled, url);
    await page.getByText('How do you comfort Mia?').waitFor({ timeout: 15000 });
    await box(page, 'Add to I call Mia').fill('Honey');
    await box(page, 'Add to I call Mia').press('Enter');
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('dialog', { name: 'Leave without saving?' }).waitFor();
    await shot(page, '5-unsaved', 800);
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}
if (errors.length) {
  console.error('page errors:\n' + errors.join('\n'));
  process.exit(1);
}
