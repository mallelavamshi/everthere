import type { MeResponse } from '@everthere/shared';
import type { DeviceRegistration, RolePref } from './storage';

export type Role = RolePref;
export type Home = '/parent' | '/admin' | '/caregiver' | '/onboarding';

export interface RoleOpts {
  /** This device's classroom-tablet registration as stored (see storage.getDevice); validated here against `me`. */
  device?: DeviceRegistration | null;
}

/**
 * The stored tablet registration, but only when it belongs to an org this person teaches at or administers. Anything
 * else (left behind by "Peek as a Teacher", or by staff who signed out) belongs to someone else and is ignored.
 */
export function validDevice(me: MeResponse, device: DeviceRegistration | null | undefined): DeviceRegistration | null {
  if (!device) return null;
  const { teacherOrgs, adminOrgs } = me.roles;
  return [...teacherOrgs, ...adminOrgs].some((o) => o.id === device.orgId) ? device : null;
}

/**
 * Roles this person can use, in default priority order:
 * caregiver (on a registered device) > admin > parent > caregiver (teacher or home caregiver elsewhere).
 */
export function availableRoles(me: MeResponse, opts: RoleOpts = {}): Role[] {
  const { roles } = me;
  const registered = !!validDevice(me, opts.device);
  const caregiver = registered || roles.teacherOrgs.length > 0 || roles.homeCaregiverFamilies.length > 0;
  const out: Role[] = [];
  if (caregiver && registered) out.push('caregiver');
  if (roles.adminOrgs.length > 0) out.push('admin');
  if (roles.parent) out.push('parent');
  if (caregiver && !registered) out.push('caregiver');
  return out;
}

export const pathFor = (role: Role): Exclude<Home, '/onboarding'> => `/${role}`;

/** Landing route: the stored preference while it is still available, else the first role, else onboarding. */
export function homeFor(me: MeResponse, preferred?: Role | null, opts: RoleOpts = {}): Home {
  const roles = availableRoles(me, opts);
  const pick = preferred && roles.includes(preferred) ? preferred : roles[0];
  return pick ? pathFor(pick) : '/onboarding';
}
