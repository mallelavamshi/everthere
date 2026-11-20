// "Who's teaching?" PIN step on a phone in landscape (863x360, device test I-2) and a 7" tablet in landscape (1024x600):
// screenshots, and asserts that every key and "Pick someone else" sit fully inside the viewport and take a real tap.
// Usage: node scripts/pin-shots.mjs [outDir]
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(process.argv[2] ?? '../../docs/notes/ui');
mkdirSync(outDir, { recursive: true });
const server = await createServer({ server: { port: 5196, strictPort: true }, logLevel: 'error' });
await server.listen();
const base = 'http://localhost:5196';
const html = await server.transformIndexHtml(
  '/__pin.html',
  '<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" /></head><body><div id="root"></div><script type="module" src="/src/features/dev/SwitchTeacherHarness.tsx"></script></body></html>',
);
const browser = await chromium.launch({ ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) });
const problems = [];

async function run(name, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${name}: ${e}`));
  let posted = null;
  await page.route(`${base}/__pin.html`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await page.route('**/api/**', (route) => {
    const req = route.request();
    const ok = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (/staff\/switch/.test(req.url())) return ok({ staff: [{ userId: 't1', name: 'Jess Parker', hasPin: true }, { userId: 't2', name: 'Tanya Brooks', hasPin: true }] });
    if (/\/acting$/.test(new URL(req.url()).pathname)) {
      posted = req.postDataJSON();
      return ok({ error: { code: 'FORBIDDEN', message: 'nope' } }, 403);
    }
    return ok({});
  });
  await page.goto(`${base}/__pin.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', { name: /Jess Parker/ }).click({ timeout: 40000 });
  await page.getByRole('dialog', { name: /enter your PIN/ }).waitFor();
  await page.waitForTimeout(700); // sheet slide-up
  await page.screenshot({ path: `${outDir}/pin-${name}-${width}x${height}.png` });
  for (const label of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'Delete', 'Pick someone else']) {
    const box = await page.getByRole('button', { name: label, exact: true }).boundingBox();
    if (!box || box.y < 0 || box.x < 0 || box.y + box.height > height + 0.5 || box.x + box.width > width + 0.5) {
      problems.push(`${name}: "${label}" is not fully on screen (${JSON.stringify(box)})`);
    }
  }
  // Real taps (no element.click()): the keypad must answer to touch where it is drawn.
  for (const d of '1234') await page.getByRole('button', { name: d, exact: true }).tap();
  await page.getByText(/didn't match/).waitFor({ timeout: 5000 }).catch(() => problems.push(`${name}: no wrong-PIN message after tapping 1234`));
  if (!posted || posted.pin !== '1234') problems.push(`${name}: the PIN was not submitted (${JSON.stringify(posted)})`);
  await page.screenshot({ path: `${outDir}/pin-${name}-${width}x${height}-after.png` });
  console.log('shot', name, `${width}x${height}`);
  await ctx.close();
}

try {
  await run('phone-landscape', 863, 360);
  await run('tablet-landscape', 1024, 600);
  await run('phone-portrait', 412, 839);
} finally {
  await browser.close();
  await server.close();
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('all keys reachable');
