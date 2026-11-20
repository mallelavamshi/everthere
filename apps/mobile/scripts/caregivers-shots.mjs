// Screenshots the Caregivers tab + InviteSheet + Remove confirm at 390x844 against a mocked API (DEV parent preview).
// Usage: node scripts/caregivers-shots.mjs [outDir]
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(process.argv[2] ?? '../../docs/notes/ui');
mkdirSync(outDir, { recursive: true });
const server = await createServer({ server: { port: 5197, strictPort: true }, logLevel: 'error' });
await server.listen();
const base = 'http://localhost:5197';
const browser = await chromium.launch({ ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) });

const photo = `${base}/src/assets/img/moment.feltBetter.webp`;
const kids = [
  { id: 'c1', name: 'Leo', photoKey: null, photoUrl: photo, familyId: 'f1', birthday: '2022-03-02', timezone: 'America/New_York' },
  { id: 'c2', name: 'Mia', photoKey: null, familyId: 'f1', birthday: '2020-01-02', timezone: 'America/New_York' },
];
const full = {
  daycare: { connectionId: 'd1', org: { id: 'o1', name: 'Sunny Days Daycare' }, transcriptAccess: false, teachers: ['Jess Park', 'Amir Khan', 'Lena Cruz', 'Bo Chen', 'Ivy Rose', 'Tom Hill', 'Sue Lee'].map((name, i) => ({ userId: `t${i}`, name })) },
  home: [
    { connectionId: 'h1', userId: 'u9', name: 'Rosa', transcriptAccess: true },
    { connectionId: 'h2', userId: 'u8', name: 'Grandma Joy', transcriptAccess: false },
  ],
};
const errors = [];
async function open(name, caregivers, children = kids) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => localStorage.setItem('everthere.devPreview', 'parent'));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    const ok = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/children') return ok({ children });
    if (p.endsWith('/caregivers')) return ok(caregivers);
    if (p === '/invites') return ok({ code: 'K7M2QX', expiresAt: Date.now() + 7 * 864e5 });
    return ok({});
  });
  await page.goto(`${base}/parent/caregivers`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  return page;
}
const shot = async (page, n) => { await page.waitForTimeout(700); await page.screenshot({ path: `${outDir}/caregivers-${n}.png` }); console.log('shot', n); };

try {
  { const p = await open('warm', full); await p.getByText('Rosa').waitFor({ timeout: 40000 }); await p.context().close(); }
  { const p = await open('tab', full); await p.getByText('Rosa').waitFor(); await shot(p, '1-tab'); await p.getByRole('button', { name: 'Mia' }).waitFor(); await p.context().close(); }
  { const p = await open('empty', { home: [] }); await p.getByText('Your village').waitFor(); await shot(p, '2-empty'); await p.context().close(); }
  {
    const p = await open('invite', full); await p.getByText('Rosa').waitFor();
    await p.getByRole('button', { name: /Invite a nanny/ }).click();
    await p.getByRole('button', { name: 'Leo' }).waitFor(); await shot(p, '3a-invite-before');
    await p.getByRole('button', { name: 'Leo' }).click(); await p.getByRole('button', { name: 'Mia' }).click();
    await p.getByRole('button', { name: 'Generate code' }).click();
    await p.getByText('K7M2QX').waitFor(); await shot(p, '3b-invite-after');
    await p.context().close();
  }
  {
    const p = await open('remove', full); await p.getByText('Rosa').waitFor();
    await p.getByRole('button', { name: 'Remove Rosa' }).click();
    await p.getByRole('dialog').waitFor(); await shot(p, '4-remove-confirm');
    await p.context().close();
  }
} finally { await browser.close(); await server.close(); }
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
