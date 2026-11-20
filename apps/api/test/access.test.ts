import { describe, it, expect, beforeAll } from 'vitest';
import { makeApp, seedRows } from './helpers';
import {
  isParentOf, isAdminOf, caregiverChildIds, canViewChild, canStartSession, canStartSessionInOrg, daycareOrgOf, canReadTranscript, canSeeSummary,
  requireParentOf, requireAdminOf, requireViewChild, requireStartSession, requireReadTranscript, requireSeeSummary,
} from '../src/auth/access';

const { env } = makeApp();
const q = (sql: string, ...b: unknown[]) => env.DB.prepare(sql).bind(...b).run();

// Fixture (all ids prefixed "ac_"): org A (A1, A2), teacher T1 in A1, admin AD,
// org B with admin ADB and child CB. F1 (parent P1, child C1 in A1), F2 (parent P2, child C2 in A2, nanny N2).
beforeAll(async () => {
  await seedRows(env, {
    org: [{ id: 'ac_A', name: 'A' }, { id: 'ac_B', name: 'B' }],
    org_member: [
      { org_id: 'ac_A', user_id: 'ac_T1', role: 'teacher' },
      { org_id: 'ac_A', user_id: 'ac_AD', role: 'admin' },
      { org_id: 'ac_B', user_id: 'ac_ADB', role: 'admin' },
    ],
    classroom: [
      { id: 'ac_A1', org_id: 'ac_A', name: 'A1' },
      { id: 'ac_A2', org_id: 'ac_A', name: 'A2' },
      { id: 'ac_B1', org_id: 'ac_B', name: 'B1' },
    ],
    classroom_staff: [{ classroom_id: 'ac_A1', user_id: 'ac_T1' }],
    family: [
      { id: 'ac_F1', created_at: 1 }, { id: 'ac_F2', created_at: 1 }, { id: 'ac_FB', created_at: 1 },
    ],
    family_member: [
      { family_id: 'ac_F1', user_id: 'ac_P1', role: 'parent' },
      { family_id: 'ac_F2', user_id: 'ac_P2', role: 'parent' },
      { family_id: 'ac_FB', user_id: 'ac_PB', role: 'parent' },
    ],
    child: [
      { id: 'ac_C1', family_id: 'ac_F1', name: 'C1' },
      { id: 'ac_C2', family_id: 'ac_F2', name: 'C2' },
      { id: 'ac_CB', family_id: 'ac_FB', name: 'CB' },
    ],
    classroom_child: [
      { classroom_id: 'ac_A1', child_id: 'ac_C1' },
      { classroom_id: 'ac_A2', child_id: 'ac_C2' },
      { classroom_id: 'ac_B1', child_id: 'ac_CB' },
    ],
    connection: [
      { id: 'ac_cn1', child_id: 'ac_C1', kind: 'daycare', org_id: 'ac_A', transcript_access: 0 },
      { id: 'ac_cn2', child_id: 'ac_C2', kind: 'daycare', org_id: 'ac_A', transcript_access: 0 },
      { id: 'ac_cnB', child_id: 'ac_CB', kind: 'daycare', org_id: 'ac_B', transcript_access: 0 },
      { id: 'ac_cnN', child_id: 'ac_C2', kind: 'home', caregiver_user_id: 'ac_N2', transcript_access: 0 },
    ],
    avatar: [
      { id: 'ac_av1', user_id: 'ac_P1', status: 'approved' },
      { id: 'ac_av1u', user_id: 'ac_P1', status: 'ready' },
      { id: 'ac_av2', user_id: 'ac_P2', status: 'approved' },
    ],
    comfort_session: [
      { id: 'ac_s1', child_id: 'ac_C1', avatar_id: 'ac_av1', caregiver_user_id: 'ac_T1', org_id: 'ac_A', started_at: 1, kind: 'child' },
      { id: 'ac_s2', child_id: 'ac_C2', avatar_id: 'ac_av2', caregiver_user_id: 'ac_N2', org_id: null, started_at: 1, kind: 'child' },
      { id: 'ac_st', child_id: null, avatar_id: 'ac_av1', caregiver_user_id: 'ac_P1', org_id: null, started_at: 1, kind: 'test' },
    ],
  });
});

describe('parent / admin', () => {
  it('isParentOf', async () => {
    expect(await isParentOf(env, 'ac_P1', 'ac_C1')).toBe(true);
    expect(await isParentOf(env, 'ac_P1', 'ac_C2')).toBe(false);
    expect(await isParentOf(env, 'ac_T1', 'ac_C1')).toBe(false);
  });
  it('isAdminOf: teacher is not admin; admin of B is not admin of A', async () => {
    expect(await isAdminOf(env, 'ac_AD', 'ac_A')).toBe(true);
    expect(await isAdminOf(env, 'ac_T1', 'ac_A')).toBe(false);
    expect(await isAdminOf(env, 'ac_ADB', 'ac_A')).toBe(false);
  });
});

describe('caregiverChildIds / canViewChild', () => {
  it('teacher sees only own classroom', async () => {
    expect(await caregiverChildIds(env, 'ac_T1')).toEqual(['ac_C1']);
  });
  it('admin sees all linked children of own org only', async () => {
    expect(await caregiverChildIds(env, 'ac_AD')).toEqual(['ac_C1', 'ac_C2']);
  });
  it('admin of org B cannot see org A children', async () => {
    expect(await caregiverChildIds(env, 'ac_ADB')).toEqual(['ac_CB']);
    expect(await canViewChild(env, 'ac_ADB', 'ac_C1')).toBe(false);
  });
  it('home caregiver sees only their child', async () => {
    expect(await caregiverChildIds(env, 'ac_N2')).toEqual(['ac_C2']);
  });
  it('cross-family leak is blocked; parents see own child only', async () => {
    expect(await canViewChild(env, 'ac_N2', 'ac_C1')).toBe(false);
    expect(await canViewChild(env, 'ac_P1', 'ac_C1')).toBe(true);
    expect(await canViewChild(env, 'ac_P1', 'ac_C2')).toBe(false);
    expect(await canViewChild(env, 'ac_T1', 'ac_C2')).toBe(false);
    expect(await canViewChild(env, 'ac_nobody', 'ac_C1')).toBe(false);
  });
  it('a child without a daycare connection in the classroom is not visible to the teacher', async () => {
    await seedRows(env, {
      child: [{ id: 'ac_Cx', family_id: 'ac_F1', name: 'x' }],
      classroom_child: [{ classroom_id: 'ac_A1', child_id: 'ac_Cx' }],
    });
    expect(await caregiverChildIds(env, 'ac_T1')).toEqual(['ac_C1']);
    expect(await caregiverChildIds(env, 'ac_AD')).toEqual(['ac_C1', 'ac_C2']);
  });
  it('removed classroom_staff loses access', async () => {
    await seedRows(env, { classroom_staff: [{ classroom_id: 'ac_A2', user_id: 'ac_T1' }] });
    expect(await caregiverChildIds(env, 'ac_T1')).toEqual(['ac_C1', 'ac_C2']);
    await q('DELETE FROM classroom_staff WHERE classroom_id=? AND user_id=?', 'ac_A2', 'ac_T1');
    expect(await caregiverChildIds(env, 'ac_T1')).toEqual(['ac_C1']);
    await q('DELETE FROM classroom_staff WHERE classroom_id=? AND user_id=?', 'ac_A1', 'ac_T1');
    expect(await caregiverChildIds(env, 'ac_T1')).toEqual([]);
    expect(await canViewChild(env, 'ac_T1', 'ac_C1')).toBe(false);
    await seedRows(env, { classroom_staff: [{ classroom_id: 'ac_A1', user_id: 'ac_T1' }] });
  });
  it('org_member removed but stale classroom_staff left: access is lost', async () => {
    await q('UPDATE connection SET transcript_access=1 WHERE id=?', 'ac_cn1');
    expect(await canReadTranscript(env, 'ac_T1', 'ac_s1')).toBe(true);
    await q('DELETE FROM org_member WHERE org_id=? AND user_id=?', 'ac_A', 'ac_T1');
    expect(await caregiverChildIds(env, 'ac_T1')).toEqual([]);
    expect(await canViewChild(env, 'ac_T1', 'ac_C1')).toBe(false);
    expect(await canStartSession(env, 'ac_T1', 'ac_C1', 'ac_av1')).toBe(false);
    expect(await canReadTranscript(env, 'ac_T1', 'ac_s1')).toBe(false);
    await seedRows(env, { org_member: [{ org_id: 'ac_A', user_id: 'ac_T1', role: 'teacher' }] });
    await q('UPDATE connection SET transcript_access=0 WHERE id=?', 'ac_cn1');
    expect(await caregiverChildIds(env, 'ac_T1')).toEqual(['ac_C1']);
  });
  it('de-duplicates when multiple paths lead to the same child', async () => {
    await seedRows(env, {
      classroom_staff: [{ classroom_id: 'ac_A1', user_id: 'ac_AD' }],
      connection: [{ id: 'ac_cnAD', child_id: 'ac_C1', kind: 'home', caregiver_user_id: 'ac_AD', transcript_access: 0 }],
    });
    expect(await caregiverChildIds(env, 'ac_AD')).toEqual(['ac_C1', 'ac_C2']);
    await q('DELETE FROM classroom_staff WHERE user_id=?', 'ac_AD');
    await q('DELETE FROM connection WHERE id=?', 'ac_cnAD');
  });
});

describe('canStartSession', () => {
  it('requires approved avatar of the childs own family', async () => {
    expect(await canStartSession(env, 'ac_T1', 'ac_C1', 'ac_av1')).toBe(true);
    expect(await canStartSession(env, 'ac_T1', 'ac_C1', 'ac_av1u')).toBe(false); // not approved
    expect(await canStartSession(env, 'ac_T1', 'ac_C1', 'ac_av2')).toBe(false); // wrong family's avatar
    expect(await canStartSession(env, 'ac_T1', 'ac_C1', 'ac_missing')).toBe(false);
  });
  it('caller must be a caregiver (parents/outsiders/other-classroom staff cannot)', async () => {
    expect(await canStartSession(env, 'ac_P1', 'ac_C1', 'ac_av1')).toBe(false);
    expect(await canStartSession(env, 'ac_N2', 'ac_C1', 'ac_av1')).toBe(false);
    expect(await canStartSession(env, 'ac_ADB', 'ac_C1', 'ac_av1')).toBe(false);
    expect(await canStartSession(env, 'ac_N2', 'ac_C2', 'ac_av2')).toBe(true);
  });
  it('home caregiver cannot start after connection is deleted', async () => {
    await q('DELETE FROM connection WHERE id=?', 'ac_cnN');
    expect(await canStartSession(env, 'ac_N2', 'ac_C2', 'ac_av2')).toBe(false);
    await seedRows(env, { connection: [{ id: 'ac_cnN', child_id: 'ac_C2', kind: 'home', caregiver_user_id: 'ac_N2', transcript_access: 0 }] });
  });
});

describe('canStartSessionInOrg (acting on a shared tablet)', () => {
  it('teacher/admin reach the child only through the given org', async () => {
    expect(await canStartSessionInOrg(env, 'ac_T1', 'ac_C1', 'ac_av1', 'ac_A')).toBe(true);
    expect(await canStartSessionInOrg(env, 'ac_AD', 'ac_C2', 'ac_av2', 'ac_A')).toBe(true);
    expect(await canStartSessionInOrg(env, 'ac_T1', 'ac_C1', 'ac_av1', 'ac_B')).toBe(false);
    expect(await canStartSessionInOrg(env, 'ac_ADB', 'ac_C1', 'ac_av1', 'ac_B')).toBe(false);
    expect(await canStartSessionInOrg(env, 'ac_ADB', 'ac_C1', 'ac_av1', 'ac_A')).toBe(false);
  });
  it('the home path never counts, whatever the org', async () => {
    expect(await canStartSession(env, 'ac_N2', 'ac_C2', 'ac_av2')).toBe(true);
    expect(await canStartSessionInOrg(env, 'ac_N2', 'ac_C2', 'ac_av2', 'ac_A')).toBe(false);
  });
  it('still requires an approved avatar of the childs own family', async () => {
    expect(await canStartSessionInOrg(env, 'ac_T1', 'ac_C1', 'ac_av1u', 'ac_A')).toBe(false);
    expect(await canStartSessionInOrg(env, 'ac_T1', 'ac_C1', 'ac_av2', 'ac_A')).toBe(false);
  });
});

describe('daycareOrgOf', () => {
  it('org of the teacher/admin path, else null (home only / no access)', async () => {
    expect(await daycareOrgOf(env, 'ac_T1', 'ac_C1')).toBe('ac_A');
    expect(await daycareOrgOf(env, 'ac_AD', 'ac_C2')).toBe('ac_A');
    expect(await daycareOrgOf(env, 'ac_N2', 'ac_C2')).toBeNull();
    expect(await daycareOrgOf(env, 'ac_ADB', 'ac_C1')).toBeNull();
  });
});

describe('canReadTranscript / canSeeSummary', () => {
  it('parent can; parent of another family cannot', async () => {
    expect(await canReadTranscript(env, 'ac_P1', 'ac_s1')).toBe(true);
    expect(await canReadTranscript(env, 'ac_P2', 'ac_s1')).toBe(false);
    expect(await canSeeSummary(env, 'ac_P1', 'ac_s1')).toBe(true);
    expect(await canSeeSummary(env, 'ac_P2', 'ac_s1')).toBe(false);
  });
  it('daycare staff: default off, on after parent enables, off again after revoke', async () => {
    expect(await canReadTranscript(env, 'ac_T1', 'ac_s1')).toBe(false);
    expect(await canSeeSummary(env, 'ac_T1', 'ac_s1')).toBe(true);
    await q('UPDATE connection SET transcript_access=1 WHERE id=?', 'ac_cn1');
    expect(await canReadTranscript(env, 'ac_T1', 'ac_s1')).toBe(true);
    expect(await canReadTranscript(env, 'ac_AD', 'ac_s1')).toBe(true);
    expect(await canReadTranscript(env, 'ac_ADB', 'ac_s1')).toBe(false); // other org
    expect(await canReadTranscript(env, 'ac_N2', 'ac_s1')).toBe(false);
    await q('UPDATE connection SET transcript_access=0 WHERE id=?', 'ac_cn1');
    expect(await canReadTranscript(env, 'ac_T1', 'ac_s1')).toBe(false);
  });
  it('daycare transcript flag does not leak a home session, and home flag is per caregiver', async () => {
    await q('UPDATE connection SET transcript_access=1 WHERE id=?', 'ac_cn2');
    expect(await canReadTranscript(env, 'ac_AD', 'ac_s2')).toBe(false); // s2 has org_id null
    expect(await canReadTranscript(env, 'ac_N2', 'ac_s2')).toBe(false); // own home flag still 0
    await q('UPDATE connection SET transcript_access=1 WHERE id=?', 'ac_cnN');
    expect(await canReadTranscript(env, 'ac_N2', 'ac_s2')).toBe(true);
    expect(await canSeeSummary(env, 'ac_N2', 'ac_s1')).toBe(false);
    await q('UPDATE connection SET transcript_access=0 WHERE id IN (?,?)', 'ac_cn2', 'ac_cnN');
  });
  it("a nanny's home transcript access covers home sessions only, never the child's daycare sessions", async () => {
    await seedRows(env, {
      comfort_session: [
        { id: 'ac_s2d', child_id: 'ac_C2', avatar_id: 'ac_av2', caregiver_user_id: 'ac_AD', org_id: 'ac_A', started_at: 2, kind: 'child' },
      ],
    });
    await q('UPDATE connection SET transcript_access=1 WHERE id=?', 'ac_cnN');
    expect(await canReadTranscript(env, 'ac_N2', 'ac_s2')).toBe(true); // home session
    expect(await canReadTranscript(env, 'ac_N2', 'ac_s2d')).toBe(false); // daycare session of the same child
    await q('UPDATE connection SET transcript_access=0 WHERE id=?', 'ac_cnN');
  });
  it('test sessions readable only by avatar owner', async () => {
    expect(await canReadTranscript(env, 'ac_P1', 'ac_st')).toBe(true);
    expect(await canReadTranscript(env, 'ac_P2', 'ac_st')).toBe(false);
    expect(await canReadTranscript(env, 'ac_T1', 'ac_st')).toBe(false);
    expect(await canSeeSummary(env, 'ac_P2', 'ac_st')).toBe(false);
  });
  it('unknown session -> false', async () => {
    expect(await canReadTranscript(env, 'ac_P1', 'ac_nope')).toBe(false);
    expect(await canSeeSummary(env, 'ac_P1', 'ac_nope')).toBe(false);
  });
});

describe('require wrappers throw FORBIDDEN', () => {
  const forbidden = { status: 403 };
  it('throws on deny, resolves on allow', async () => {
    await expect(requireParentOf(env, 'ac_P2', 'ac_C1')).rejects.toMatchObject(forbidden);
    await expect(requireAdminOf(env, 'ac_T1', 'ac_A')).rejects.toMatchObject(forbidden);
    await expect(requireViewChild(env, 'ac_N2', 'ac_C1')).rejects.toMatchObject(forbidden);
    await expect(requireStartSession(env, 'ac_T1', 'ac_C1', 'ac_av2')).rejects.toMatchObject(forbidden);
    await expect(requireReadTranscript(env, 'ac_T1', 'ac_s1')).rejects.toMatchObject(forbidden);
    await expect(requireSeeSummary(env, 'ac_P2', 'ac_s1')).rejects.toMatchObject(forbidden);
    await expect(requireParentOf(env, 'ac_P1', 'ac_C1')).resolves.toBeUndefined();
    await expect(requireViewChild(env, 'ac_T1', 'ac_C1')).resolves.toBeUndefined();
  });
});
