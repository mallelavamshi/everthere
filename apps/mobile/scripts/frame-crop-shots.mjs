// Task 28 (experiment): the live frame in each crop mode on a portrait phone, with the DEV fake call (?fake=1, a real
// 1280x720 stream). One shot per mode at 360x800 and 412x915, plus the effective scale of the visible source region in
// device px at DPR 2.625 and 3, a long-press check (cycles the mode, shows a toast) and the mic-permission card in a
// crop mode (never clipped). Fails on a page error, a frame outside the stage, or a clipped permission card.
// Usage: node scripts/frame-crop-shots.mjs [outDir]   -> 28-frame-<mode>-<w>.png (mode 16x9, 1x1, 4x5, 3x4)
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(process.argv[2] ?? '../../docs/notes/device');
mkdirSync(outDir, { recursive: true });

const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const url = 'http://localhost:5199/dev/live/child?fake=1&scenario=long';
const micUrl = 'http://localhost:5199/dev/live/child?fake=1&scenario=micPending';
const KEY = 'everthere.liveFrameMode';
const MODES = ['16:9', '1:1', '4:5', '3:4'];
const ASPECT = { '16:9': 16 / 9, '1:1': 1, '4:5': 0.8, '3:4': 0.75 };
const SIZES = [
  [360, 800],
  [412, 915],
];
const SRC = { w: 1280, h: 720 };

const errors = [];
const rows = [];
const ctxFor = async (w, h, mode) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await ctx.addInitScript(([k, m]) => localStorage.setItem(k, m), [KEY, mode]);
  return ctx;
};
const geometry = (page) =>
  page.evaluate(() => {
    const r = (s) => {
      const b = document.querySelector(s)?.getBoundingClientRect();
      return b && { x: b.x, y: b.y, w: b.width, h: b.height };
    };
    const v = document.querySelector('video.np_companion-avatar-video');
    const hero = document.querySelector('[data-testid=live-hero]');
    return {
      mode: hero?.getAttribute('data-frame-mode'),
      crop: hero?.classList.contains('is-crop'),
      video: [v?.videoWidth, v?.videoHeight],
      fit: v && getComputedStyle(v).objectFit,
      hero: r('[data-testid=live-hero]'),
      stage: r('[data-testid=live-stage]'),
    };
  });

try {
  {
    const warm = await browser.newPage();
    await warm.goto(url, { waitUntil: 'networkidle' });
    await warm.getByText('Bunny sleepy', { exact: false }).first().waitFor({ timeout: 60000 });
    await warm.close();
  }
  for (const [w, h] of SIZES) {
    for (const mode of MODES) {
      const ctx = await ctxFor(w, h, mode);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${mode}@${w}: ${e}`));
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.getByText('while it feels better', { exact: false }).first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(1200);
      const g = await geometry(page);
      if (g.mode !== mode) errors.push(`${mode}@${w}: hero is in mode ${g.mode}`);
      const s = g.stage;
      const f = g.hero;
      if (f.x < s.x - 0.5 || f.y < s.y - 0.5 || f.x + f.w > s.x + s.w + 0.5 || f.y + f.h > s.y + s.h + 0.5) errors.push(`${mode}@${w}: frame leaves the stage`);
      // The visible source region: the full 720 rows and 720*aspect columns in a crop mode; all 1280x720 in 16:9.
      const visW = mode === '16:9' ? SRC.w : SRC.h * ASPECT[mode];
      const scale = (dpr) => +((f.w * dpr) / visW).toFixed(2);
      rows.push({ w, h, mode, frame: `${f.w.toFixed(0)}x${f.h.toFixed(0)}`, stage: `${s.w.toFixed(0)}x${s.h.toFixed(0)}`, visible: `${visW}x${SRC.h}`, fit: g.fit, 'x2.625': scale(2.625), x3: scale(3) });
      const file = `${outDir}/28-frame-${mode.replace(':', 'x')}-${w}.png`;
      await page.screenshot({ path: file });
      console.log('shot', file);
      await ctx.close();
    }
  }
  console.table(rows);

  // Long-press (mouse held 700 ms on the frame) cycles 4:5 -> 3:4 and toasts; a short click does nothing.
  {
    const ctx = await ctxFor(360, 800, '4:5');
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`longpress: ${e}`));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.getByText('while it feels better', { exact: false }).first().waitFor({ timeout: 15000 });
    const f = (await geometry(page)).hero;
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    await page.mouse.click(cx, cy, { delay: 150 });
    await page.waitForTimeout(800);
    const afterTap = (await geometry(page)).mode;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.waitForTimeout(750);
    await page.mouse.up();
    await page.getByText('Frame 3:4').first().waitFor({ timeout: 3000 });
    const afterHold = (await geometry(page)).mode;
    const stored = await page.evaluate((k) => localStorage.getItem(k), KEY);
    console.log('longpress', JSON.stringify({ afterTap, afterHold, stored }));
    if (afterTap !== '4:5') errors.push(`a short tap changed the mode to ${afterTap}`);
    if (afterHold !== '3:4' || stored !== '3:4') errors.push(`long-press: ${afterHold} / stored ${stored}`);
    await page.screenshot({ path: `${outDir}/28-frame-longpress-toast-360.png` });
    await ctx.close();
  }

  // The SDK's mic-permission card in a crop mode: laid out over the whole stage, not clipped by the frame.
  for (const [w, h] of SIZES) {
    const ctx = await ctxFor(w, h, '4:5');
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`mic@${w}: ${e}`));
    await page.goto(micUrl, { waitUntil: 'networkidle' });
    await page.getByText('Allow microphone access').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(400);
    const m = await page.evaluate(() => {
      const c = document.querySelector('.np_companion-mic-permission-card').getBoundingClientRect();
      const s = document.querySelector('[data-testid=live-stage]').getBoundingClientRect();
      const hero = document.querySelector('[data-testid=live-hero]');
      const hit = document.elementFromPoint(c.x + c.width / 2, c.y + c.height - 4);
      return { card: [c.x, c.y, c.width, c.height].map(Math.round), stage: [s.x, s.y, s.width, s.height].map(Math.round), crop: hero.classList.contains('is-crop'), cardOnTop: !!hit?.closest('.np_companion-mic-permission-card') };
    });
    console.log('mic', w, JSON.stringify(m));
    if (m.crop) errors.push(`mic@${w}: the hero is cropped in permission mode`);
    if (!m.cardOnTop || m.card[0] < m.stage[0] || m.card[0] + m.card[2] > m.stage[0] + m.stage[2]) errors.push(`mic@${w}: the card is clipped`);
    await page.screenshot({ path: `${outDir}/28-frame-mic-permission-${w}.png` });
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}
if (errors.length) {
  console.error('errors:\n' + errors.join('\n'));
  process.exit(1);
}
