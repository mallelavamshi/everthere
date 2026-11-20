import { useSyncExternalStore } from 'react';
import type { AlertView } from '@everthere/shared';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { routeForAlert } from './alertsRoute';

// Local notifications for new alerts. The OS permission (Android 13+) is asked for only when the first
// notification is about to show, and only after a friendly "why" sheet. If it is declined, the in-app bell
// badge still does the job.

const CHANNEL = 'everthere-alerts';
/** More than this many new alerts at once become a single "N new updates" notification. */
const MAX_INDIVIDUAL = 3;

const isNative = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

// ---- the "why" sheet ---------------------------------------------------------------------------------------------

let primerOpen = false;
let primerAnswer: ((ok: boolean) => void) | null = null;
let declined = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const notificationPrimer = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  getSnapshot: () => primerOpen,
  /** The sheet's buttons. */
  answer(ok: boolean) {
    const done = primerAnswer;
    primerAnswer = null;
    primerOpen = false;
    if (!ok) declined = true;
    emit();
    done?.(ok);
  },
  /** Forget everything (sign-out, tests): a sheet or a notification still waiting is dropped. */
  reset() {
    const done = primerAnswer;
    const waiting = waiters;
    primerAnswer = null;
    primerOpen = false;
    declined = false;
    waiters = [];
    emit();
    done?.(false);
    waiting.forEach((w) => w(false));
  },
};

export const useNotificationPrimer = (): boolean =>
  useSyncExternalStore(notificationPrimer.subscribe, notificationPrimer.getSnapshot, () => false);

// The sheet is only for calm places (Home, Sessions, Alerts): never mid avatar setup, onboarding or a live call.
// A notification that wants to ask waits here until the parent is somewhere calm.
let allowed = true;
let waiters: Array<(ok: boolean) => void> = [];
export function setPrimerAllowed(v: boolean): void {
  allowed = v;
  if (!v) return;
  const w = waiters;
  waiters = [];
  w.forEach((f) => f(true));
}
const whenAllowed = (): Promise<boolean> => (allowed ? Promise.resolve(true) : new Promise((res) => waiters.push(res)));

function askFirst(): Promise<boolean> {
  if (primerAnswer) return new Promise((res) => {
    const prev = primerAnswer!;
    primerAnswer = (ok) => {
      prev(ok);
      res(ok);
    };
  });
  return new Promise((res) => {
    primerAnswer = res;
    primerOpen = true;
    emit();
  });
}

/** true when notifications may be shown. Asks (politely, once per launch) when the OS has not been asked yet. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const cur = (await LocalNotifications.checkPermissions()).display;
    if (cur === 'granted') return true;
    if (cur === 'denied' || declined) return false;
    if (!(await whenAllowed()) || !(await askFirst())) return false;
    return (await LocalNotifications.requestPermissions()).display === 'granted';
  } catch {
    return false;
  }
}

// ---- showing them -----------------------------------------------------------------------------------------------

/** A stable positive 31-bit id for an alert id (Android notification ids are ints). */
export function notificationId(alertId: string): number {
  let h = 0;
  for (let i = 0; i < alertId.length; i++) h = (Math.imul(h, 31) + alertId.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

let channelMade = false;
async function ensureChannel(): Promise<void> {
  if (channelMade) return;
  channelMade = true;
  try {
    await LocalNotifications.createChannel({ id: CHANNEL, name: 'Comfort call updates', description: 'Summaries and moments worth a look', importance: 4 });
  } catch {
    /* older Android / web: the default channel is fine */
  }
}

export async function showAlertNotifications(fresh: AlertView[]): Promise<void> {
  if (!fresh.length || !(await ensureNotificationPermission())) return;
  await ensureChannel();
  const notifications =
    fresh.length > MAX_INDIVIDUAL
      ? [{ id: notificationId(`group-${fresh[0]!.id}`), title: `${fresh.length} new updates on EverThere`, body: 'Open the app to see how things went 💛', channelId: CHANNEL, extra: { kind: 'other', refId: null } }]
      : fresh.map((a) => ({
          id: notificationId(a.id),
          title: a.title,
          body: a.body ?? '',
          channelId: CHANNEL,
          extra: { kind: a.kind, refId: a.refId },
        }));
  await LocalNotifications.schedule({ notifications });
}

/** Removes pending and already-shown notifications (sign-out, account change): one person's alerts must not outlive them. */
export async function clearNotifications(): Promise<void> {
  notificationPrimer.reset();
  if (!isNative()) return;
  try {
    const { notifications } = await LocalNotifications.getPending();
    if (notifications.length) await LocalNotifications.cancel({ notifications: notifications.map((n) => ({ id: n.id })) });
  } catch {
    /* nothing to cancel */
  }
  try {
    await LocalNotifications.removeAllDeliveredNotifications();
  } catch {
    /* nothing delivered, or not supported */
  }
}

/** Calls `go(path)` when a notification is tapped. Returns the unsubscribe. */
export function onNotificationTap(go: (path: string) => void): () => void {
  if (!isNative()) return () => {};
  let handle: { remove: () => Promise<void> } | null = null;
  let cancelled = false;
  void Promise.resolve(
    LocalNotifications.addListener('localNotificationActionPerformed', (e) => {
      const extra = (e.notification.extra ?? {}) as { kind?: string; refId?: string | null };
      go(routeForAlert(extra.kind ?? '', extra.refId));
    }),
  )
    .then((h) => {
      if (cancelled) void h.remove();
      else handle = h;
    })
    .catch(() => {});
  return () => {
    cancelled = true;
    void handle?.remove();
  };
}
