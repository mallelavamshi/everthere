// Screenshots the sessions feed, session detail and alerts at 390x844 against a mocked API (DEV parent preview).
// Usage: node scripts/sessions-shots.mjs [outDir]
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(process.argv[2] ?? '../../docs/notes/ui');
mkdirSync(outDir, { recursive: true });
const server = await createServer({ server: { port: 5198, strictPort: true }, logLevel: 'error' });
await server.listen();
const base = 'http://localhost:5198';
const browser = await chromium.launch({ ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) });

const photo = `${base}/src/assets/img/moment.feltBetter.webp`;
const mia = { id: 'c1', name: 'Mia', photoKey: null, photoUrl: photo, familyId: 'f1', birthday: '2022-03-02', timezone: 'America/New_York' };
const avatar = { id: 'av1', status: 'approved', voiceId: 'coral', photoKey: 'k', photoUrl: photo, parentTitle: 'Mom', consentName: 'Sarah Lee', consentAt: 1, approvedAt: 2, createdAt: 1, hasAgent: true };

const at = (daysAgo, h, m) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(h, m, 0, 0); return d.getTime(); };
const s = (id, daysAgo, h, m, over = {}) => ({ id, child: { id: 'c1', name: 'Mia' }, caregiverName: 'Ms. Jess', reason: 'upset_nap', startedAt: at(daysAgo, h, m), durationS: 240, moodAfter: 'calmer', summary: 'You sang Twinkle Twinkle together and talked about Bunny\'s picnic. She lay down for nap right after.', moodSignal: null, flags: [], ...over });
const flag = { id: 'f1', category: 'injury', severity: 'low', quote: 'my knee hurts from the slide', source: 'live', createdAt: 1, acknowledgedAt: null };
const feed = [
  s('s1', 0, 11, 20, { flags: [flag] }),
  s('s2', 0, 9, 5, { reason: 'missing_parent', moodAfter: null, summary: null }),
  s('s3', 1, 14, 40, { reason: 'boo_boo', moodAfter: 'same', durationS: 360, summary: 'You gave Mia a big cuddle after the slide and counted to ten together.' }),
  s('s4', 1, 8, 15, { reason: 'new_nervous', moodAfter: 'upset', summary: 'It was a tough start to the day. You stayed close and talked about her favourite bunny.' }),
  s('s5', 3, 12, 30, { reason: 'missing_parent', moodAfter: 'calmer', durationS: 180 }),
];
const transcript = [
  ['Assistant', 'Hey Sunshine! Is Bunny sleepy too? 🐰'],
  ['User', 'I miss you mommy'],
  ['Assistant', 'I miss you too, Mia-bear. Want to sing our star song?'],
  ['User', 'yeah 🎵'],
  ['Assistant', 'Twinkle, twinkle, little star... you sing the next part!'],
  ['User', 'how I wonder what you are'],
].map(([role, text], i) => ({ role, text, timestamp: new Date(at(0, 11, 20) + i * 22_000).toISOString() }));
const detail = { ...feed[0], caregiverNote: 'She skipped her snack but ate a big lunch.', transcript };
const noAccess = { ...feed[0], caregiverNote: null };
const alerts = [
  { id: 'a1', kind: 'flag', refId: 's1', title: 'A moment worth a look', body: 'Mia mentioned her knee hurts after the slide.', readAt: null, createdAt: Date.now() - 6 * 60_000 },
  { id: 'a2', kind: 'summary', refId: 's1', title: 'Mia felt better 💛', body: 'Ms. Jess finished a comfort call. Tap to read the summary.', readAt: null, createdAt: Date.now() - 22 * 60_000 },
  { id: 'a3', kind: 'avatar_ready', refId: 'av1', title: 'Your avatar is ready', body: 'Test it and approve it whenever you like.', readAt: Date.now() - 3600_000, createdAt: Date.now() - 5 * 3600_000 },
  { id: 'a4', kind: 'invite', refId: 'i1', title: 'Rosa joined your village', body: 'She can now start comfort calls for Mia.', readAt: Date.now() - 3600_000, createdAt: Date.now() - 2 * 86_400_000 },
];

const errors = [];
async function open(name, path, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => localStorage.setItem('everthere.devPreview', 'parent'));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    const ok = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/children') return ok({ children: [mia] });
    if (p === '/avatars/mine') return ok([avatar]);
    if (p.startsWith('/alerts')) return ok({ items: (route.request().url().includes('unread=1') ? alerts.filter((a) => !a.readAt) : alerts).slice(0, o.noAlerts ? 0 : 50) });
    if (/\/sessions\/s1$/.test(p)) return ok(o.noAccess ? noAccess : detail);
    if (p === '/sessions') return ok({ items: o.empty ? [] : feed, nextCursor: null });
    if (/\/plans\//.test(p)) return ok({ todayNote: 'Grandma picks up at 4', todayNoteExpiresAt: null });
    return ok({});
  });
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  return page;
}
const shot = async (page, n) => { await page.waitForTimeout(900); await page.screenshot({ path: `${outDir}/sessions-${n}.png` }); console.log('shot', n); };

try {
  { const p = await open('warm', '/parent/sessions'); await p.getByText('Mia felt better').first().waitFor({ timeout: 40000 }); await p.context().close(); }
  { const p = await open('feed', '/parent/sessions'); await p.getByText('Yesterday').waitFor(); await shot(p, '1-feed'); await p.context().close(); }
  { const p = await open('empty', '/parent/sessions', { empty: true }); await p.getByText('No comfort calls yet').waitFor(); await shot(p, '2-empty'); await p.context().close(); }
  { const p = await open('detail', '/parent/sessions/s1'); await p.getByText('how I wonder what you are').waitFor(); await shot(p, '3-detail'); await p.context().close(); }
  { const p = await open('private', '/parent/sessions/s1', { noAccess: true }); await p.getByText(/private to Mia/).waitFor(); await shot(p, '4-detail-private'); await p.context().close(); }
  { const p = await open('alerts', '/parent/alerts'); await p.getByText('Rosa joined your village').waitFor(); await shot(p, '5-alerts'); await p.context().close(); }
  { const p = await open('home', '/parent'); await p.getByRole('button', { name: /Alerts, 2 unread/ }).waitFor(); await p.getByText(/Mia felt better/).first().waitFor(); await shot(p, '6-home-bell'); await p.context().close(); }
} finally { await browser.close(); await server.close(); }
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
