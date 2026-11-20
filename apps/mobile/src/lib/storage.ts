import { Preferences } from '@capacitor/preferences';
import { clearSeen } from './alertsSeen';
import { clearNotifications } from './notifications';
import { clearSelectedChild } from './selectedChild';
import { resetSwitchPrompt } from './switchPrompt';

// Everything the app remembers on-device lives in Capacitor Preferences (SharedPreferences on Android,
// localStorage on the web). Every read is defensive: storage can be unavailable or hold stale shapes.

export type RolePref = 'parent' | 'admin' | 'caregiver';
export interface ActingToken {
  token: string;
  /** Epoch ms; an expired token is never sent. */
  expiresAt: number;
  /** Who is teaching, for the "Ms. Jess · Switch" chip. Old tokens without these still work. */
  teacherUserId?: string;
  teacherName?: string;
}
/** Set when this device was registered as a shared classroom tablet. */
export interface DeviceRegistration {
  orgId: string;
  deviceId: string;
}

const KEYS = {
  acting: 'everthere.actingToken',
  role: 'everthere.rolePref',
  device: 'everthere.device',
  lastUser: 'everthere.lastUserId',
  tabletAsked: 'everthere.tabletAsked',
} as const;

async function read<T>(key: string): Promise<T | null> {
  try {
    const { value } = await Preferences.get({ key });
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}
async function write(key: string, value: unknown): Promise<void> {
  try {
    await Preferences.set({ key, value: JSON.stringify(value) });
  } catch {
    /* a remembered preference is a nicety */
  }
}
async function remove(key: string): Promise<void> {
  try {
    await Preferences.remove({ key });
  } catch {
    /* ignore */
  }
}

export async function getActingToken(now = Date.now()): Promise<ActingToken | null> {
  const t = await read<ActingToken>(KEYS.acting);
  if (!t || typeof t.token !== 'string' || typeof t.expiresAt !== 'number') return null;
  return t.expiresAt > now ? t : null;
}
export const setActingToken = (t: ActingToken) => write(KEYS.acting, t);
export const clearActingToken = () => remove(KEYS.acting);

const ROLES: readonly string[] = ['parent', 'admin', 'caregiver'];
export async function getRolePref(): Promise<RolePref | null> {
  const r = await read<string>(KEYS.role);
  return r && ROLES.includes(r) ? (r as RolePref) : null;
}
export const setRolePref = (r: RolePref) => write(KEYS.role, r);
export const clearRolePref = () => remove(KEYS.role);

export async function getDevice(): Promise<DeviceRegistration | null> {
  const d = await read<DeviceRegistration>(KEYS.device);
  return d && typeof d.orgId === 'string' && typeof d.deviceId === 'string' ? d : null;
}
export const setDevice = (d: DeviceRegistration) => write(KEYS.device, d);
export const clearDevice = () => remove(KEYS.device);

/** Whether this device was already asked "Is this a shared classroom tablet?" (either answer). It belongs to the device. */
export async function getTabletAsked(): Promise<boolean> {
  return (await read<boolean>(KEYS.tabletAsked)) === true;
}
export const setTabletAsked = () => write(KEYS.tabletAsked, true);

/** Clerk user id the on-device state belongs to ('' = nobody). Lets the gate spot an account change across launches. */
export async function getLastUser(): Promise<string | null> {
  return (await read<string>(KEYS.lastUser)) ?? null;
}
export const setLastUser = (id: string | null) => write(KEYS.lastUser, id ?? '');

/** Everything tied to the signed-in person. The device registration belongs to the tablet, so it stays. */
export async function clearSessionStorage(): Promise<void> {
  resetSwitchPrompt(); // the next person on a shared tablet is asked who is teaching again
  await Promise.all([clearActingToken(), clearRolePref(), clearSelectedChild(), clearSeen(), clearNotifications()]);
}
