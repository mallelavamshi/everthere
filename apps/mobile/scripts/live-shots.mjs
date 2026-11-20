// Starts the Vite dev server in-process and screenshots the live session screen with the DEV fake Napster SDK
// (/dev/live/:mode?fake=1&scenario=...) at 390x844 (phone) and 1024x768 (tablet), then exits.
// Usage: node scripts/live-shots.mjs [outDir]
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(process.argv[2] ?? '../../docs/notes/ui');
mkdirSync(outDir, { recursive: true });

const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const base = 'http://localhost:5199/dev/live';

const shots = [
  // name, path, wait for (text or ms)
  ['1-connecting', '/child?fake=1&scenario=connecting', { text: 'Calling Mom…', extra: 600 }],
  ['2-live-captions', '/child?fake=1&scenario=captions', { text: 'big cuddle', extra: 1800 }],
  ['3-flag-banner', '/child?fake=1&scenario=flag', { text: 'Flagged for Mom', extra: 700 }],
  ['4-eight-minute-notice', '/child?fake=1&scenario=captions&warnAt=2600', { text: "Let's start saying bye-bye soon", extra: 2500 }],
  ['5-busy-error', '/child?fake=1&scenario=busy', { text: 'All our avatars are busy hugging', extra: 600 }],
  ['6-test-call', '/test?fake=1&scenario=captions', { text: 'Bunny sleepy', extra: 1500 }],
  ['7-long-caption', '/child?fake=1&scenario=long', { text: 'while it feels better', extra: 1200 }],
];

const viewports = [
  ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ['tablet', { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }],
];

const errors = [];
try {
  // Warm-up: Vite's first visit optimises dependencies and reloads the page, which would blank the first shot.
  {
    const warm = await browser.newPage();
    await warm.goto(`${base}/child?fake=1&scenario=captions`, { waitUntil: 'networkidle' });
    await warm.getByText('Bunny sleepy', { exact: false }).first().waitFor({ timeout: 30000 });
    await warm.close();
  }
  for (const [vp, opts] of viewports) {
    const ctx = await browser.newContext(opts);
    for (const [name, path, wait] of shots) {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${name}/${vp}: ${e}`));
      page.on('console', (m) => m.type() === 'error' && !/Clerk|clerk|Failed to load resource/.test(m.text()) && errors.push(`${name}/${vp}: ${m.text()}`));
      await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.getByText(wait.text, { exact: false }).first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(wait.extra);
      const file = `${outDir}/live-${name}-${vp}.png`;
      await page.screenshot({ path: file });
      console.log('shot', file);
      await page.close();
    }
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
