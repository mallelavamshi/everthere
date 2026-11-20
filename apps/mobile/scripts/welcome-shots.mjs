// The Welcome screen on three phone sizes (task 26c): 360x640, 390x844 and 412x915. Prints the gap between the
// subtitle and the first button, and the hero's size. Fails if, on the two tall phones, the content needs scrolling or
// is not centred above the buttons, or if more than 120 px is left empty between the subtitle and the buttons.
// Usage: node scripts/welcome-shots.mjs [tag] [outDir]   -> welcome-<w>x<h>-<tag>.png (tag defaults to "after")
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const tag = process.argv[2] ?? 'after';
const outDir = resolve(process.argv[3] ?? '../../docs/notes/ui');
mkdirSync(outDir, { recursive: true });

const server = await createServer({ server: { port: 5195, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const url = 'http://localhost:5195/dev/onboarding';
const sizes = [
  [360, 640],
  [390, 844],
  [412, 915],
];
const errors = [];
try {
  {
    const warm = await browser.newPage();
    await warm.goto(url, { waitUntil: 'networkidle' });
    await warm.getByRole('button', { name: /I'm a parent/ }).waitFor({ timeout: 40000 });
    await warm.close();
  }
  for (const [width, height] of sizes) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${width}x${height}: ${e}`));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole('button', { name: /I'm a parent/ }).waitFor();
    await page.waitForTimeout(900);
    const g = await page.evaluate(() => {
      const main = document.querySelector('main');
      const sub = [...document.querySelectorAll('p')].find((p) => p.textContent?.startsWith('Your face'));
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes("I'm a parent"));
      const img = document.querySelector('img');
      const r = (e) => e?.getBoundingClientRect();
      return {
        scrolls: main.scrollHeight > main.clientHeight + 1,
        gap: Math.round(r(btn).top - r(sub).bottom),
        hero: [Math.round(r(img).width), Math.round(r(img).height)],
        top: Math.round(r(main.firstElementChild?.firstElementChild ?? main).top),
      };
    });
    console.log(`${width}x${height}`, JSON.stringify(g));
    if (height > 700 && g.scrolls) errors.push(`${width}x${height}: the content scrolls`);
    // Centred: the space above the logo and below the subtitle match (less the 28 px of fixed padding above the buttons).
    if (height > 700 && Math.abs(g.gap - 28 - (g.top - 8)) > 24) errors.push(`${width}x${height}: not centred (top ${g.top}, gap ${g.gap})`);
    if (g.gap > 120) errors.push(`${width}x${height}: ${g.gap} px empty between the subtitle and the buttons`);
    const file = `${outDir}/welcome-${width}x${height}-${tag}.png`;
    await page.screenshot({ path: file });
    console.log('shot', file);
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}
if (errors.length) {
  console.error('problems:\n' + errors.join('\n'));
  process.exit(1);
}
