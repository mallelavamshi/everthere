// Device test P-3/P-6: the live call's avatar frame at the video's own aspect ratio (the DEV fake streams 1280x720),
// with a long avatar caption and a child line, on a phone in portrait (the phone test's 384x832 CSS px) and a tablet
// in landscape. Safe-area insets are not emulated by the browser.
// Also (fix round 1): the SDK's mic-permission card over the stage (fake scenario "micPending"), and the phone with
// Android's 1.3x system text size simulated (every font size x1.3), to check the latest caption stays fully visible.
// Usage: node scripts/live-frame-shots.mjs [outDir]
//   -> live-frame-{phone,tablet}.png, live-mic-permission-{phone,tablet}.png, live-frame-phone-text130.png
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(process.argv[2] ?? '../../docs/notes/ui');
mkdirSync(outDir, { recursive: true });

const server = await createServer({ server: { port: 5198, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const url = 'http://localhost:5198/dev/live/child?fake=1&scenario=long';
const micUrl = 'http://localhost:5198/dev/live/child?fake=1&scenario=micPending';

/** Android text zoom scales every font size; emulate it by scaling each element's own font size (not inherited ones). */
const textZoom = (k) => {
  const scale = (el) => {
    if (!(el instanceof HTMLElement) || el.dataset.tz) return;
    const own = parseFloat(getComputedStyle(el).fontSize);
    const parent = el.parentElement ? parseFloat(getComputedStyle(el.parentElement).fontSize) : NaN;
    el.dataset.tz = '1';
    if (el === document.documentElement || own !== parent) el.style.fontSize = `${own * k}px`;
    // Children that inherited the old size now inherit the new one; children with their own size are scaled below.
  };
  const all = (root) => {
    scale(root);
    root.querySelectorAll?.('*').forEach(scale);
  };
  const go = () => {
    all(document.documentElement);
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && all(n)))).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
  else go();
};

const viewports = [
  ['phone', { viewport: { width: 384, height: 832 }, deviceScaleFactor: 2.8125, isMobile: true, hasTouch: true }],
  ['tablet', { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }],
];

const errors = [];
try {
  {
    const warm = await browser.newPage();
    await warm.goto(url, { waitUntil: 'networkidle' });
    await warm.getByText('Bunny sleepy', { exact: false }).first().waitFor({ timeout: 30000 });
    await warm.close();
  }
  const geometry = async (page) =>
    page.evaluate(() => {
      const r = (s) => document.querySelector(s)?.getBoundingClientRect();
      const v = document.querySelector('video.np_companion-avatar-video');
      const caps = [...document.querySelectorAll('[data-testid=caption]')].map((c) => c.getBoundingClientRect());
      const nav = r('nav[aria-label="Call controls"]');
      return {
        video: [v?.videoWidth, v?.videoHeight],
        hero: r('[data-testid=live-hero]'),
        lastCaptionBottom: caps.at(-1)?.bottom,
        captionsBottom: r('[data-testid=live-captions]')?.bottom,
        controlsTop: nav?.top,
      };
    });
  // Text zoom 1.3 on the phone.
  {
    const ctx = await browser.newContext(viewports[0][1]);
    await ctx.addInitScript(textZoom, 1.3);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`text130: ${e}`));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.getByText('while it feels better', { exact: false }).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(1200);
    const g = await geometry(page);
    console.log('phone text130', JSON.stringify(g));
    if (!(g.lastCaptionBottom <= g.controlsTop)) errors.push(`text130: the latest caption reaches the controls (${g.lastCaptionBottom} > ${g.controlsTop})`);
    await page.screenshot({ path: `${outDir}/live-frame-phone-text130.png` });
    console.log('shot', `${outDir}/live-frame-phone-text130.png`);
    await ctx.close();
  }
  for (const [vp, opts] of viewports) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`mic/${vp}: ${e}`));
    await page.goto(micUrl, { waitUntil: 'networkidle' });
    await page.getByText('Allow microphone access').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(400);
    const card = await page.evaluate(() => {
      const c = document.querySelector('.np_companion-mic-permission-card')?.getBoundingClientRect();
      const st = document.querySelector('[data-testid=live-stage]')?.getBoundingClientRect();
      return { card: c && [Math.round(c.left), Math.round(c.top), Math.round(c.width), Math.round(c.height)], stage: st && [Math.round(st.left), Math.round(st.top), Math.round(st.width), Math.round(st.height)] };
    });
    console.log('mic', vp, JSON.stringify(card));
    await page.screenshot({ path: `${outDir}/live-mic-permission-${vp}.png` });
    console.log('shot', `${outDir}/live-mic-permission-${vp}.png`);
    await ctx.close();
  }
  for (const [vp, opts] of viewports) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${vp}: ${e}`));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.getByText('while it feels better', { exact: false }).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(1200);
    const geo = await geometry(page);
    console.log(vp, JSON.stringify(geo));
    const file = `${outDir}/live-frame-${vp}.png`;
    await page.screenshot({ path: file });
    console.log('shot', file);
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
