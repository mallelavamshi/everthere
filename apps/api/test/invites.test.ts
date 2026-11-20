import { describe, it, expect } from 'vitest';
import { makeApp, authAs, seedRows } from './helpers';
import { generateCode, createInvite, CODE_ALPHABET } from '../src/lib/invites';
import { verifyPin } from '../src/auth/acting';

const { env, request } = makeApp();
const NOW = Date.now();

function post(path: string, user: string, body: unknown) {
  return request(path, {
    method: 'POST',
    headers: { ...authAs(user), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const redeem = (user: string, body: Record<string, unknown>) => post('/api/invites/redeem', user, body);
async function code(res: Response) {
  return ((await res.json()) as { error?: { code: string } }).error?.code;
}
const q = <T>(sql: string, ...b: unknown[]) =>
  env.DB.prepare(sql)
    .bind(...b)
    .all<T>()
    .then((r) => r.results);

async function seedUsers(...ids: string[]) {
  await seedRows(env, { user: ids.map((id) => ({ id, name: `N ${id}`, email: `${id}@x`, created_at: NOW })) });
}

describe('generateCode', () => {
  it('6 chars from the alphabet', () => {
    expect(CODE_ALPHABET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789');
    for (let i = 0; i < 300; i++) expect(generateCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  });
});

describe('invite redemption', () => {
  it('twice -> second INVITE_INVALID; lowercase works; expired invalid; unknown invalid', async () => {
    await seedUsers('i1a', 'i1b', 'i1c');
    await seedRows(env, { family: [{ id: 'i1fam', created_at: NOW }], family_member: [{ family_id: 'i1fam', user_id: 'i1a' }] });
    const { code: c } = await createInvite(env, { type: 'co_parent', payload: { familyId: 'i1fam' }, createdBy: 'i1a' });
    expect((await redeem('i1b', { code: c.toLowerCase() })).status).toBe(200);
    const again = await redeem('i1c', { code: c });
    expect(again.status).toBe(400);
    expect(await code(again)).toBe('INVITE_INVALID');
    await seedRows(env, {
      invite_code: [{ code: 'EXPRD2', type: 'co_parent', payload: '{"familyId":"i1fam"}', created_by: 'i1a', expires_at: NOW - 1000 }],
    });
    expect(await code(await redeem('i1c', { code: 'EXPRD2' }))).toBe('INVITE_INVALID');
    expect(await code(await redeem('i1c', { code: 'NOPE22' }))).toBe('INVITE_INVALID');
  });

  it('own invite -> INVITE_INVALID, and stays unused', async () => {
    await seedUsers('i2a');
    await seedRows(env, { family: [{ id: 'i2fam', created_at: NOW }], family_member: [{ family_id: 'i2fam', user_id: 'i2a' }] });
    const { code: c } = await createInvite(env, { type: 'co_parent', payload: { familyId: 'i2fam' }, createdBy: 'i2a' });
    expect(await code(await redeem('i2a', { code: c }))).toBe('INVITE_INVALID');
    expect((await q('SELECT used_at FROM invite_code WHERE code=?', c))[0]).toEqual({ used_at: null });
  });

  it('co_parent adds member; existing member is idempotent', async () => {
    await seedUsers('i3a', 'i3b');
    await seedRows(env, {
      family: [{ id: 'i3fam', created_at: NOW }],
      family_member: [
        { family_id: 'i3fam', user_id: 'i3a' },
        { family_id: 'i3fam', user_id: 'i3b' },
      ],
    });
    const { code: c } = await createInvite(env, { type: 'co_parent', payload: { familyId: 'i3fam' }, createdBy: 'i3a' });
    expect((await redeem('i3b', { code: c })).status).toBe(200);
    expect(await q('SELECT 1 FROM family_member WHERE family_id=?', 'i3fam')).toHaveLength(2);
    await seedUsers('i3c');
    const r2 = await createInvite(env, { type: 'co_parent', payload: { familyId: 'i3fam' }, createdBy: 'i3a' });
    expect((await redeem('i3c', { code: r2.code })).status).toBe(200);
    expect(await q('SELECT 1 FROM family_member WHERE family_id=? AND user_id=?', 'i3fam', 'i3c')).toHaveLength(1);
  });

  it('home_caregiver creates home connections, transcript_access 0', async () => {
    await seedUsers('i4a', 'i4b');
    await seedRows(env, {
      family: [{ id: 'i4fam', created_at: NOW }],
      family_member: [{ family_id: 'i4fam', user_id: 'i4a' }],
      child: [
        { id: 'i4k1', family_id: 'i4fam', name: 'K1' },
        { id: 'i4k2', family_id: 'i4fam', name: 'K2' },
      ],
    });
    const { code: c } = await createInvite(env, {
      type: 'home_caregiver',
      payload: { familyId: 'i4fam', childIds: ['i4k1', 'i4k2'] },
      createdBy: 'i4a',
    });
    expect((await redeem('i4b', { code: c })).status).toBe(200);
    const rows = await q<{ child_id: string; transcript_access: number; kind: string }>(
      `SELECT child_id, transcript_access, kind FROM connection WHERE caregiver_user_id='i4b' ORDER BY child_id`,
    );
    expect(rows).toEqual([
      { child_id: 'i4k1', transcript_access: 0, kind: 'home' },
      { child_id: 'i4k2', transcript_access: 0, kind: 'home' },
    ]);
  });

  it('staff: needs 4-digit PIN (INVALID, code unspent); adds teacher + PIN', async () => {
    await seedUsers('i5a', 'i5b');
    await seedRows(env, {
      org: [{ id: 'i5org', name: 'Org5', timezone: 'UTC' }],
      org_member: [{ org_id: 'i5org', user_id: 'i5a', role: 'admin' }],
    });
    const { code: c } = await createInvite(env, { type: 'staff', payload: { orgId: 'i5org' }, createdBy: 'i5a' });
    const none = await redeem('i5b', { code: c });
    expect(none.status).toBe(400);
    expect(await code(none)).toBe('INVALID');
    expect(await code(await redeem('i5b', { code: c, pin: '12' }))).toBe('INVALID');
    expect(await code(await redeem('i5b', { code: c, pin: '12a4' }))).toBe('INVALID');
    expect((await redeem('i5b', { code: c, pin: '4821' })).status).toBe(200);
    expect(await q('SELECT role FROM org_member WHERE org_id=? AND user_id=?', 'i5org', 'i5b')).toEqual([{ role: 'teacher' }]);
    expect(await verifyPin(env, 'i5b', 'i5org', '4821')).toBe(true);
    expect(await verifyPin(env, 'i5b', 'i5org', '4822')).toBe(false);
    expect(await verifyPin(env, 'nobody', 'i5org', '4821')).toBe(false);
    const [row] = await q<{ pin_hash: string }>('SELECT pin_hash FROM staff_pin WHERE user_id=?', 'i5b');
    expect(row!.pin_hash).toMatch(/^pbkdf2\$100000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  async function seedEnrollment(p: string) {
    await seedUsers(`${p}a`, `${p}b`);
    await seedRows(env, {
      org: [{ id: `${p}org`, name: 'Sunny Daycare', timezone: 'America/Chicago' }],
      classroom: [{ id: `${p}cl`, org_id: `${p}org`, name: 'Bees' }],
      enrollment: [
        { id: `${p}en`, org_id: `${p}org`, classroom_id: `${p}cl`, child_name: 'Mia', invite_code: 'X', status: 'invited', created_at: NOW },
      ],
    });
    return createInvite(env, { type: 'parent_enrollment', payload: { orgId: `${p}org`, enrollmentId: `${p}en` }, createdBy: `${p}a` });
  }

  it('parent_enrollment: creates family+child (org tz), connection, classroom_child, linked', async () => {
    const { code: c } = await seedEnrollment('i6');
    const peek = await post('/api/invites/peek', 'i6b', { code: c });
    expect(await peek.json()).toEqual({ type: 'parent_enrollment', orgName: 'Sunny Daycare', childName: 'Mia', inviterName: 'N i6a' });
    expect((await redeem('i6b', { code: c })).status).toBe(200);
    const kids = await q<{ id: string; name: string; timezone: string }>(
      `SELECT c.id, c.name, c.timezone FROM child c JOIN family_member fm ON fm.family_id=c.family_id WHERE fm.user_id='i6b'`,
    );
    expect(kids).toHaveLength(1);
    expect(kids[0]).toMatchObject({ name: 'Mia', timezone: 'America/Chicago' });
    expect(await q('SELECT 1 FROM connection WHERE child_id=? AND kind=? AND org_id=?', kids[0]!.id, 'daycare', 'i6org')).toHaveLength(1);
    expect(await q('SELECT 1 FROM classroom_child WHERE classroom_id=? AND child_id=?', 'i6cl', kids[0]!.id)).toHaveLength(1);
    expect(await q('SELECT status, child_id FROM enrollment WHERE id=?', 'i6en')).toEqual([{ status: 'linked', child_id: kids[0]!.id }]);
  });

  it('peek on used code -> INVITE_INVALID', async () => {
    const { code: c } = await seedEnrollment('i12');
    expect((await redeem('i12b', { code: c })).status).toBe(200);
    expect(await code(await post('/api/invites/peek', 'i12b', { code: c }))).toBe('INVITE_INVALID');
  });

  it('parent_enrollment with existingChildId links that child (parent only)', async () => {
    const { code: c } = await seedEnrollment('i7');
    await seedRows(env, {
      family: [{ id: 'i7fam', created_at: NOW }],
      family_member: [{ family_id: 'i7fam', user_id: 'i7b' }],
      child: [
        { id: 'i7k', family_id: 'i7fam', name: 'Existing', timezone: 'UTC' },
        { id: 'i7other', family_id: 'zzz', name: 'Other' },
      ],
    });
    expect((await redeem('i7b', { code: c, existingChildId: 'i7other' })).status).toBe(403);
    expect((await q('SELECT used_at FROM invite_code WHERE code=?', c))[0]).toEqual({ used_at: null });
    expect((await redeem('i7b', { code: c, existingChildId: 'i7k' })).status).toBe(200);
    expect(await q('SELECT 1 FROM child WHERE family_id=?', 'i7fam')).toHaveLength(1);
    expect(await q('SELECT 1 FROM connection WHERE child_id=? AND org_id=?', 'i7k', 'i7org')).toHaveLength(1);
    expect(await q('SELECT child_id FROM enrollment WHERE id=?', 'i7en')).toEqual([{ child_id: 'i7k' }]);
  });

  it('concurrent redeems: exactly one success, effects applied once', async () => {
    const { code: c } = await seedEnrollment('i8');
    await seedUsers('i8c', 'i8d');
    const rs = await Promise.all(['i8b', 'i8c', 'i8d'].map((u) => redeem(u, { code: c })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 400)).toHaveLength(2);
    expect(await q('SELECT 1 FROM connection WHERE org_id=?', 'i8org')).toHaveLength(1);
    expect(await q('SELECT 1 FROM classroom_child WHERE classroom_id=?', 'i8cl')).toHaveLength(1);
  });
});

describe('POST /api/invites (create)', () => {
  it('requires auth', async () => {
    expect((await request('/api/invites', { method: 'POST', body: '{}' })).status).toBe(401);
  });

  it('co_parent: parent only; returns code + expiry', async () => {
    await seedUsers('i9a', 'i9x');
    await seedRows(env, { family: [{ id: 'i9fam', created_at: NOW }], family_member: [{ family_id: 'i9fam', user_id: 'i9a' }] });
    expect((await post('/api/invites', 'i9x', { type: 'co_parent', familyId: 'i9fam' })).status).toBe(403);
    const ok = await post('/api/invites', 'i9a', { type: 'co_parent', familyId: 'i9fam' });
    expect(ok.status).toBe(200);
    const b = (await ok.json()) as { code: string; expiresAt: number };
    expect(b.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(b.expiresAt).toBeGreaterThan(Date.now() + 6 * 86_400_000);
  });

  it("home_caregiver cannot include another family's child", async () => {
    await seedUsers('i10a');
    await seedRows(env, {
      family: [
        { id: 'i10fam', created_at: NOW },
        { id: 'i10oth', created_at: NOW },
      ],
      family_member: [{ family_id: 'i10fam', user_id: 'i10a' }],
      child: [
        { id: 'i10k', family_id: 'i10fam', name: 'K' },
        { id: 'i10o', family_id: 'i10oth', name: 'O' },
      ],
    });
    const bad = await post('/api/invites', 'i10a', { type: 'home_caregiver', familyId: 'i10fam', childIds: ['i10k', 'i10o'] });
    expect(bad.status).toBe(403);
    const good = await post('/api/invites', 'i10a', { type: 'home_caregiver', familyId: 'i10fam', childIds: ['i10k'] });
    expect(good.status).toBe(200);
  });

  it('staff/enrollment types are not creatable via this route', async () => {
    await seedUsers('i11a');
    expect((await post('/api/invites', 'i11a', { type: 'staff', orgId: 'o' })).status).toBe(400);
  });
});

describe('same-user concurrent redeem', () => {
  it('exactly one success, one child/connection/classroom_child, even in the same millisecond', async () => {
    await seedUsers('i13a', 'i13b');
    await seedRows(env, {
      org: [{ id: 'i13org', name: 'O13', timezone: 'UTC' }],
      classroom: [{ id: 'i13cl', org_id: 'i13org', name: 'Bees' }],
      enrollment: [{ id: 'i13en', org_id: 'i13org', classroom_id: 'i13cl', child_name: 'Zed', invite_code: 'X', status: 'invited', created_at: NOW }],
    });
    const { code: c } = await createInvite(env, {
      type: 'parent_enrollment', payload: { orgId: 'i13org', enrollmentId: 'i13en' }, createdBy: 'i13a',
    });
    const real = Date.now;
    const frozen = real();
    Date.now = () => frozen; // force identical timestamps for both requests
    let rs: Response[];
    try {
      rs = await Promise.all([redeem('i13b', { code: c }), redeem('i13b', { code: c })]);
    } finally {
      Date.now = real;
    }
    expect(rs.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await q(`SELECT 1 FROM child WHERE name='Zed'`)).toHaveLength(1);
    expect(await q('SELECT 1 FROM connection WHERE org_id=?', 'i13org')).toHaveLength(1);
    expect(await q('SELECT 1 FROM classroom_child WHERE classroom_id=?', 'i13cl')).toHaveLength(1);
    expect(await q(`SELECT 1 FROM family_member WHERE user_id='i13b'`)).toHaveLength(1);
  });
});

describe('invite peek / redeem rate limit', () => {
  it('allows 10 peek or redeem tries per user per minute; the 11th is 429 RATE_LIMITED; other users are unaffected', async () => {
    await seedUsers('rl_guess', 'rl_other');
    const results: (string | undefined)[] = [];
    for (let i = 0; i < 5; i++) results.push(await code(await post('/api/invites/peek', 'rl_guess', { code: 'ZZZZZZ' })));
    for (let i = 0; i < 5; i++) results.push(await code(await redeem('rl_guess', { code: 'ZZZZZZ' })));
    expect(results.every((c) => c === 'INVITE_INVALID')).toBe(true);
    const peek = await post('/api/invites/peek', 'rl_guess', { code: 'ZZZZZZ' });
    expect([peek.status, await code(peek)]).toEqual([429, 'RATE_LIMITED']);
    const red = await redeem('rl_guess', { code: 'ZZZZZZ' });
    expect([red.status, await code(red)]).toEqual([429, 'RATE_LIMITED']);
    expect(await code(await post('/api/invites/peek', 'rl_other', { code: 'ZZZZZZ' }))).toBe('INVITE_INVALID');
  });
});
