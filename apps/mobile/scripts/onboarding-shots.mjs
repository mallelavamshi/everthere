// Starts the Vite dev server in-process, screenshots the onboarding screens (the dev preview at /dev/onboarding with
// a fake auth backend and mocked /api/*) at 390x844 with headless Chromium, then exits.
// Usage: node scripts/onboarding-shots.mjs [outDir]
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(process.argv[2] ?? '../../docs/notes/ui');
mkdirSync(outDir, { recursive: true });

const server = await createServer({ server: { port: 5198, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const base = 'http://localhost:5198/dev/onboarding';

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/Clerk|clerk|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    if (url.endsWith('/api/invites/peek')) return json(route, { type: 'staff', orgName: 'Little Acorns', inviterName: 'Ms. Rose' });
    if (url.endsWith('/api/demo/sign-in')) return json(route, { ticket: 'demo' });
    return json(route, {});
  });

  const shot = async (name) => {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${outDir}/onboarding-${name}.png` });
    console.log('shot', name);
  };
  const go = async (path) => {
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  };

  // 1. Welcome, and the demo sheet over it.
  await go('');
  await shot('1-welcome');
  await page.getByRole('button', { name: /try the demo/i }).click();
  await page.waitForTimeout(500);
  await shot('5-trydemo');

  // 2. Sign up (filled, so the password hints show).
  await go('/signup?door=parent');
  await page.getByLabel('First name').fill('Dana');
  await page.getByLabel('Last name').fill('Lee');
  await page.getByLabel('Email').fill('dana@example.com');
  await page.getByLabel('Password', { exact: true }).fill('sunny1');
  await shot('2-signup');
  await page.getByLabel('Password', { exact: true }).fill('sunny-days-1');
  await page.getByRole('button', { name: /create my account/i }).click();
  await page.getByRole('heading', { name: /check your email/i }).waitFor();
  await page.getByRole('textbox').first().click();
  await page.keyboard.type('4242');
  await shot('2b-verify');

  // 3. Join: code entry, then the PIN step.
  await go('/join?signedIn=1');
  await page.getByRole('textbox').first().click();
  await page.keyboard.insertText('abc234');
  await shot('3-join-code');
  await page.getByRole('button', { name: /continue/i }).click();
  await page.getByText(/invited you to join as a teacher/i).waitFor();
  await shot('3b-join-invite');
  await page.getByRole('button', { name: /accept/i }).click();
  await page.getByRole('heading', { name: /create your classroom pin/i }).waitFor();
  await page.getByRole('button', { name: '1', exact: true }).click();
  await page.getByRole('button', { name: '2', exact: true }).click();
  await shot('4-pin');

  // Extras: the two doors' profile steps.
  await go('/parent/start?signedIn=1');
  await page.getByLabel('Their first name').fill('Mia');
  await page.getByLabel('Birthday').fill('2022-06-10');
  await shot('6-add-child');
  await go('/daycare/start?signedIn=1');
  await page.getByLabel('Daycare name').fill('Little Acorns');
  await page.getByLabel('Address').fill('12 Oak Lane, Portland');
  await shot('7-daycare-profile');
  await page.getByRole('button', { name: /continue/i }).click();
  await page.getByRole('heading', { name: /first classroom/i }).waitFor();
  await shot('8-daycare-classroom');

  console.log(errors.length ? `ERRORS: ${errors.join(' | ')}` : 'no page errors');
  await ctx.close();
} finally {
  await browser.close();
  await server.close();
}
