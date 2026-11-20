// Starts the Vite dev server in-process, screenshots /dev/gallery with headless Chromium, then exits.
// Usage: node scripts/gallery-shots.mjs [outDir]
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(process.argv[2] ?? '../../docs/notes/ui');
mkdirSync(outDir, { recursive: true });

const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
// PW_CHROMIUM lets you point at an already-installed Chromium instead of running `npx playwright install`.
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
try {
  const shots = [
    { name: 'gallery-390x844', w: 390, h: 844, mobile: true, full: false },
    { name: 'gallery-1024x768', w: 1024, h: 768, mobile: false, full: false },
  ];
  for (const s of shots) {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto('http://localhost:5199/dev/gallery', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600);
    if (s.full) {
      // Gallery scrolls inside its own container: grow the viewport to the content height instead.
      const h = await page.evaluate(() => document.querySelector('[data-testid=gallery]').scrollHeight);
      await page.setViewportSize({ width: s.w, height: Math.min(h, 6000) });
      await page.waitForTimeout(400);
    }
    await page.screenshot({ path: `${outDir}/${s.name}.png` });
    console.log(s.name, errors.length ? `ERRORS: ${errors.join(' | ')}` : 'ok');
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}
