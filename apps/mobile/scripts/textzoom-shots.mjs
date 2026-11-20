// Large system text (task 26c): the live-call controls dock on a 360 px-wide phone at Android text zoom 1.0, 1.3 and
// 1.5, plus the parent TabBar and the nanny roster tiles at 1.3. Android text zoom is emulated by scaling every
// element's own font size (the root's too, so rem lengths grow with it: a harsher test than the real WebView, which
// scales text only). Each shot is checked: every control's circle sits inside the dock, the dock inside the screen,
// tap targets stay >= 44 px, and no label wraps or spills out of its button (an ellipsis is allowed).
// Usage: node scripts/textzoom-shots.mjs [tag] [outDir]   -> textzoom-*-<tag>.png (tag defaults to "after")
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const tag = process.argv[2] ?? 'after';
const outDir = resolve(process.argv[3] ?? '../../docs/notes/ui');
mkdirSync(outDir, { recursive: true });

const server = await createServer({ server: { port: 5196, strictPort: true }, logLevel: 'error' });
await server.listen();
const base = 'http://localhost:5196';
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

/** Android text zoom scales every font size; emulate it by scaling each element's own font size (not inherited ones). */
const textZoom = (k) => {
  const scale = (el) => {
    if (!(el instanceof HTMLElement) || el.dataset.tz) return;
    const own = parseFloat(getComputedStyle(el).fontSize);
    const parent = el.parentElement ? parseFloat(getComputedStyle(el.parentElement).fontSize) : NaN;
    el.dataset.tz = '1';
    if (el === document.documentElement || own !== parent) el.style.fontSize = `${own * k}px`;
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

const phone = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const errors = [];

async function open(name, zoom, path, { preview, mock } = {}) {
  const ctx = await browser.newContext(phone);
  if (zoom !== 1) await ctx.addInitScript(textZoom, zoom);
  if (preview) await ctx.addInitScript((p) => localStorage.setItem('everthere.devPreview', p), preview);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  if (mock) await page.route('**/api/**', mock);
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  return page;
}

/** Geometry of a row of buttons inside a container: each button's box, its round icon (if any) and its label. */
const measure = (page, container, button, circle, label) =>
  page.evaluate(
    ([container, button, circle, label]) => {
      const box = (r) => r && { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
      const c = document.querySelector(container);
      return {
        vw: innerWidth,
        vh: innerHeight,
        container: box(c?.getBoundingClientRect()),
        buttons: [...(c?.querySelectorAll(button) ?? [])].map((b) => {
          const lab = label ? b.querySelector(label) : null;
          const lh = lab ? parseFloat(getComputedStyle(lab).lineHeight) || parseFloat(getComputedStyle(lab).fontSize) * 1.25 : 0;
          return {
            name: b.getAttribute('aria-label'),
            button: box(b.getBoundingClientRect()),
            circle: circle ? box(b.querySelector(circle)?.getBoundingClientRect()) : null,
            label: lab && {
              text: lab.textContent,
              font: parseFloat(getComputedStyle(lab).fontSize),
              box: box(lab.getBoundingClientRect()),
              lines: Math.round(lab.getBoundingClientRect().height / lh),
              clipped: lab.scrollWidth > lab.clientWidth + 1,
            },
          };
        }),
      };
    },
    [container, button, circle, label],
  );

const check = (name, g, { minTap = 44, inner } = {}) => {
  const bad = [];
  const C = g.container;
  if (!C) return errors.push(`${name}: container missing`);
  if (C.l < 0 || C.r > g.vw || C.b > g.vh) bad.push(`container ${JSON.stringify(C)} leaves the ${g.vw}x${g.vh} screen`);
  for (const b of g.buttons) {
    if (b.button.w < minTap || b.button.h < minTap) bad.push(`${b.name}: tap target ${b.button.w}x${b.button.h}`);
    const shape = inner ? b.circle : b.button;
    if (shape && (shape.l < C.l || shape.r > C.r || shape.t < C.t || shape.b > C.b)) bad.push(`${b.name}: ${JSON.stringify(shape)} spills out of ${JSON.stringify(C)}`);
    if (b.label && b.label.lines > 1) bad.push(`${b.name}: label "${b.label.text}" wraps to ${b.label.lines} lines`);
    if (b.label && (b.label.box.l < b.button.l - 1 || b.label.box.r > b.button.r + 1)) bad.push(`${b.name}: label spills out of its button`);
  }
  for (const b of bad) errors.push(`${name}: ${b}`);
  const labels = g.buttons.map((b) => `${b.label?.text}${b.label?.clipped ? '(…)' : ''}@${b.label?.font}px`).join(', ');
  console.log(`${bad.length ? 'FAIL' : 'ok  '} ${name}: container ${C.w}x${C.h}; ${g.buttons.map((b) => `${b.button.w}x${b.button.h}`).join(' ')}; ${labels}`);
};

const shot = async (page, name) => {
  await page.waitForTimeout(500);
  const file = `${outDir}/textzoom-${name}-${tag}.png`;
  await page.screenshot({ path: file });
  console.log('shot', file);
};

// The nanny roster and the parent home, against a mocked API.
const photo = `${base}/src/assets/img/moment.feltBetter.webp`;
const json = (route, b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
const nannyMock = (route) => {
  const p = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
  if (p === '/caregiver/children')
    return json(route, {
      children: [
        { id: 'c1', name: 'Mia', photoUrl: photo, familyId: 'f1', readyAvatars: [{ avatarId: 'a1', parentTitle: 'Mommy' }] },
        { id: 'c2', name: 'Leo', photoUrl: null, familyId: 'f1', readyAvatars: [{ avatarId: 'a2', parentTitle: 'Mom' }, { avatarId: 'a3', parentTitle: 'Papa' }] },
        { id: 'c3', name: 'Alexandria', photoUrl: null, familyId: 'f1', readyAvatars: [] },
      ],
    });
  return json(route, {});
};
const kid = { id: 'c1', name: 'Mia', photoKey: null, photoUrl: photo, familyId: 'f1', birthday: '2021-03-02', timezone: 'America/New_York' };
const parentMock = (route) => {
  const p = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
  if (p === '/children') return json(route, { children: [kid] });
  if (p === '/avatars/mine') return json(route, []);
  if (p === '/sessions') return json(route, { items: [], nextCursor: null });
  if (p === '/alerts') return json(route, { items: [] });
  return json(route, {});
};

try {
  {
    const warm = await open('warm', 1, '/dev/live/child?fake=1&scenario=long');
    await warm.getByText('while it feels better', { exact: false }).first().waitFor({ timeout: 40000 });
    await warm.context().close();
  }
  for (const zoom of [1, 1.3, 1.5]) {
    const name = `dock-360-text${Math.round(zoom * 100)}`;
    const page = await open(name, zoom, '/dev/live/child?fake=1&scenario=long');
    await page.getByText('while it feels better', { exact: false }).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    check(name, await measure(page, 'nav[aria-label="Call controls"] > div', 'button', 'span[aria-hidden]', 'span:not([aria-hidden])'), { inner: true });
    await shot(page, name);
    await page.context().close();
  }
  {
    const name = 'tabbar-parent-360-text130';
    const page = await open(name, 1.3, '/parent', { preview: 'parent', mock: parentMock });
    await page.locator('nav[aria-label="Main"]').waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    check(name, await measure(page, 'nav[aria-label="Main"]', 'button', null, ':scope > span:last-child'));
    await shot(page, name);
    await page.context().close();
  }
  {
    const name = 'roster-nanny-360-text130';
    const page = await open(name, 1.3, '/caregiver', { preview: 'nanny', mock: nannyMock });
    await page.getByText('Alexandria').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    const tiles = await page.evaluate(() =>
      [...document.querySelectorAll('main .grid > *')].filter((t) => t.getBoundingClientRect().width > 100).map((t) => {
        const r = t.getBoundingClientRect();
        const spill = [...t.querySelectorAll('*')].some((e) => {
          const q = e.getBoundingClientRect();
          return q.width && (q.left < r.left - 1 || q.right > r.right + 1);
        });
        return { w: Math.round(r.width), h: Math.round(r.height), spill, text: t.textContent };
      }),
    );
    for (const t of tiles) if (t.spill) errors.push(`${name}: something spills out of the tile "${t.text}"`);
    console.log(`${tiles.some((t) => t.spill) ? 'FAIL' : 'ok  '} ${name}: ${JSON.stringify(tiles)}`);
    await shot(page, name);
    await page.context().close();
  }
} finally {
  await browser.close();
  await server.close();
}
if (errors.length) {
  console.error('problems:\n' + errors.join('\n'));
  process.exit(1);
}
