import { describe, expect, it } from 'vitest';
import type { MeResponse } from '@everthere/shared';
import { availableRoles, homeFor, validDevice } from '../src/lib/role';

const base = (roles: Partial<MeResponse['roles']> = {}): MeResponse => ({
  user: { id: 'u1', name: 'Kim Lee', email: 'kim@example.com', isDemo: false },
  roles: { parent: false, adminOrgs: [], teacherOrgs: [], homeCaregiverFamilies: [], ...roles },
});

describe('homeFor', () => {
  it('sends a brand new user to onboarding', () => {
    expect(homeFor(base())).toBe('/onboarding');
    expect(availableRoles(base())).toEqual([]);
  });

  it('parent only goes to /parent', () => {
    expect(homeFor(base({ parent: true }))).toBe('/parent');
  });

  it('admin and parent with no preference goes to /admin', () => {
    const me = base({ parent: true, adminOrgs: [{ id: 'o1', name: 'Sunny Days' }] });
    expect(availableRoles(me)).toEqual(['admin', 'parent']);
    expect(homeFor(me)).toBe('/admin');
  });

  it('a device registered as a caregiver goes to /caregiver, ahead of admin and parent', () => {
    const me = base({ parent: true, adminOrgs: [{ id: 'o1', name: 'Sunny Days' }], teacherOrgs: [{ id: 'o1', name: 'Sunny Days' }] });
    const device = { orgId: 'o1', deviceId: 'd1' };
    expect(homeFor(me, undefined, { device })).toBe('/caregiver');
    expect(availableRoles(me, { device })[0]).toBe('caregiver');
  });

  it("ignores a device registration for an org the person is not staff of (someone else's tablet registration)", () => {
    const stale = { orgId: 'demo.org.acorns', deviceId: 'd9' };
    const parent = base({ parent: true });
    expect(validDevice(parent, stale)).toBeNull();
    expect(homeFor(parent, undefined, { device: stale })).toBe('/parent');
    expect(availableRoles(parent, { device: stale })).toEqual(['parent']);
    // A brand new account with no roles goes to onboarding, not to a classroom.
    expect(homeFor(base(), undefined, { device: stale })).toBe('/onboarding');
    expect(availableRoles(base(), { device: stale })).toEqual([]);
    // Staff of another org: still not this tablet.
    const other = base({ teacherOrgs: [{ id: 'o2', name: 'Other' }], parent: true });
    expect(availableRoles(other, { device: stale })).toEqual(['parent', 'caregiver']);
  });

  it('accepts a registration for an org the person teaches at or administers', () => {
    const d = { orgId: 'o1', deviceId: 'd1' };
    expect(validDevice(base({ teacherOrgs: [{ id: 'o1', name: 'A' }] }), d)).toEqual(d);
    expect(validDevice(base({ adminOrgs: [{ id: 'o1', name: 'A' }] }), d)).toEqual(d);
    expect(validDevice(base({ adminOrgs: [{ id: 'o1', name: 'A' }] }), null)).toBeNull();
  });

  it('a home caregiver with no other role goes to /caregiver', () => {
    expect(homeFor(base({ homeCaregiverFamilies: [{ id: 'f1', label: 'Kim family' }] }))).toBe('/caregiver');
  });

  it('honours a stored preference only while that role is still available', () => {
    const me = base({ parent: true, adminOrgs: [{ id: 'o1', name: 'Sunny Days' }] });
    expect(homeFor(me, 'parent')).toBe('/parent');
    expect(homeFor(me, 'caregiver')).toBe('/admin');
  });
});
