// Screenshots the daycare admin screens (dashboard with flags, classrooms, staff, enrollments, EnrollSheet with a code, profile)
// at tablet 1024x768 and phone 390x844 against a mocked API (DEV admin preview).
// Usage: node scripts/admin-shots.mjs [outDir]
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

const NOW = Date.now();
const day = 864e5;
const flags = [
  { id: 'f1', sessionId: 's1', childName: 'Mia', category: 'injury', quote: 'My arm hurts where Jonah pushed me', severity: 'high', createdAt: NOW - 12 * 60_000 },
  { id: 'f2', sessionId: 's2', childName: 'Leo', category: 'scared_of_person', quote: 'I do not like the loud man', severity: 'medium', createdAt: NOW - 3 * 3600_000 },
  { id: 'f3', sessionId: 's3', childName: 'Zoe', category: 'illness', quote: null, severity: 'low', createdAt: NOW - 26 * 3600_000 },
];
const dash = { readyCount: 12, todaySessions: 5, monthSessions: 37, monthCostUsd: 18.5, openFlags: flags };
const org = { id: 'o1', name: 'Little Acorns', address: '12 Oak Street, Austin TX', timezone: 'America/Chicago', logoKey: null, logoUrl: null, role: 'admin' };
const staff = [
  { userId: 'dev_admin', name: 'Dana Director', email: 'dana@example.com', role: 'admin', hasPin: false, classroomIds: [] },
  { userId: 't1', name: 'Jess Park', email: 'jess@example.com', role: 'teacher', hasPin: true, classroomIds: ['cl1'] },
  { userId: 't2', name: 'Amir Khan', email: 'amir@example.com', role: 'teacher', hasPin: false, classroomIds: ['cl2'] },
  { userId: 't3', name: 'Lena Cruz', email: 'lena@example.com', role: 'teacher', hasPin: true, classroomIds: ['cl1', 'cl3'] },
];
const rooms = [
  { id: 'cl1', orgId: 'o1', name: 'Butterflies', emoji: null, assetKey: 'classroom.butterflies', staffUserIds: ['t1', 't3'] },
  { id: 'cl2', orgId: 'o1', name: 'Bees', emoji: null, assetKey: 'classroom.bees', staffUserIds: ['t2'] },
  { id: 'cl3', orgId: 'o1', name: 'Owls', emoji: null, assetKey: 'classroom.owls', staffUserIds: ['t3'] },
  { id: 'cl4', orgId: 'o1', name: 'Turtles', emoji: null, assetKey: 'classroom.turtles', staffUserIds: [] },
];
const enrollments = [
  { id: 'e1', orgId: 'o1', classroomId: 'cl1', childName: 'Mia Lee', inviteCode: 'MIA222', childId: 'c1', status: 'linked', createdAt: NOW - 20 * day },
  { id: 'e2', orgId: 'o1', classroomId: 'cl1', childName: 'Leo Kim', inviteCode: 'LEO333', childId: 'c2', status: 'linked', createdAt: NOW - 15 * day },
  { id: 'e3', orgId: 'o1', classroomId: 'cl2', childName: 'Zoe Patel', inviteCode: 'ZOE444', childId: null, status: 'invited', createdAt: NOW - 2 * day },
  { id: 'e4', orgId: 'o1', classroomId: 'cl3', childName: 'Max Rivera', inviteCode: 'MAX555', childId: 'c4', status: 'linked', createdAt: NOW - 9 * day },
  { id: 'e5', orgId: 'o1', classroomId: 'cl2', childName: 'Ava Nguyen', inviteCode: 'AVA666', childId: null, status: 'invited', createdAt: NOW - 9 * day },
];
const tiles = [
  { enrollmentId: 'e1', childId: 'c1', name: 'Mia Lee', status: 'ready', readyAvatars: [{ avatarId: 'a1', parentTitle: 'Mommy' }] },
  { enrollmentId: 'e2', childId: 'c2', name: 'Leo Kim', status: 'setup_pending', readyAvatars: [] },
  { enrollmentId: 'e3', name: 'Zoe Patel', status: 'invite_sent', readyAvatars: [] },
  { enrollmentId: 'e4', childId: 'c4', name: 'Max Rivera', status: 'ready', readyAvatars: [{ avatarId: 'a2', parentTitle: 'Daddy' }] },
  { enrollmentId: 'e5', name: 'Ava Nguyen', status: 'invite_sent', readyAvatars: [] },
];

const errors = [];
async function open(vp, name, path) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: vp.width < 600, hasTouch: true });
  await ctx.addInitScript(() => localStorage.setItem('everthere.devPreview', 'admin'));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  await page.route('**/api/**', (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname.replace(/^.*\/api/, '');
    const ok = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (req.method() === 'GET') {
      if (p === '/orgs/o1') return ok(org);
      if (p === '/orgs/o1/dashboard') return ok(dash);
      if (p === '/orgs/o1/classrooms') return ok({ classrooms: rooms });
      if (p === '/orgs/o1/staff') return ok({ staff });
      if (p === '/orgs/o1/enrollments') return ok({ enrollments });
      if (p === '/orgs/o1/roster') return ok({ tiles });
    }
    if (req.method() === 'POST' && p === '/orgs/o1/enrollments') return ok({ enrollment: enrollments[0], code: 'K7M2QX', expiresAt: NOW + 7 * day }, 201);
    return ok({});
  });
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  return page;
}

const sizes = { tablet: { width: 1024, height: 768 }, phone: { width: 390, height: 844 } };
const shot = async (page, name, size) => {
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${outDir}/admin-${name}-${size}.png` });
  console.log('shot', name, size);
};

try {
  {
    const p = await open(sizes.phone, 'warm', '/admin');
    await p.getByText('Open flags').waitFor({ timeout: 40000 });
    await p.context().close();
  }
  for (const [size, vp] of Object.entries(sizes)) {
    {
      const p = await open(vp, `home-${size}`, '/admin');
      await p.getByText('Open flags').waitFor();
      await shot(p, '1-home', size);
      await p.context().close();
    }
    {
      const p = await open(vp, `classrooms-${size}`, '/admin/classrooms');
      await p.getByText('Butterflies').first().waitFor();
      await shot(p, '2-classrooms', size);
      await p.context().close();
    }
    {
      const p = await open(vp, `staff-${size}`, '/admin/staff');
      await p.getByText('Jess Park').waitFor();
      await shot(p, '3-staff', size);
      await p.context().close();
    }
    {
      const p = await open(vp, `enroll-${size}`, '/admin/enrollments');
      await p.getByText('Zoe Patel').waitFor();
      await shot(p, '4-enrollments', size);
      await p.getByRole('button', { name: 'Enroll a child' }).click();
      await p.getByLabel('Child’s name').fill('Noah Brooks');
      await p.getByRole('radio', { name: 'Bees' }).click();
      await p.getByRole('button', { name: 'Create invite' }).click();
      await p.getByText('K7M2QX').waitFor();
      await shot(p, '5-enrollsheet-code', size);
      await p.context().close();
    }
    {
      const p = await open(vp, `profile-${size}`, '/admin/profile');
      await p.getByLabel('Daycare name').waitFor();
      await shot(p, '6-profile', size);
      await p.context().close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
