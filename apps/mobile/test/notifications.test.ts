import type { AlertView } from '@everthere/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ln = vi.hoisted(() => ({
  display: 'prompt' as string,
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  schedule: vi.fn(async () => ({})),
  createChannel: vi.fn(async () => {}),
  addListener: vi.fn(),
  getPending: vi.fn(async () => ({ notifications: [{ id: 7 }, { id: 9 }] })),
  cancel: vi.fn(async () => {}),
  removeAllDeliveredNotifications: vi.fn(async () => {}),
}));
vi.mock('@capacitor/core', async (orig) => ({ ...(await orig<typeof import('@capacitor/core')>()), Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: ln }));

import { clearNotifications, notificationPrimer, onNotificationTap, setPrimerAllowed, showAlertNotifications } from '../src/lib/notifications';
import { clearSessionStorage } from '../src/lib/storage';

const alert = (id: string): AlertView => ({ id, kind: 'summary', refId: `s-${id}`, title: `Title ${id}`, body: 'Body', readAt: null, createdAt: 1 });
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  notificationPrimer.reset();
  ln.display = 'prompt';
  ln.checkPermissions.mockReset().mockImplementation(async () => ({ display: ln.display }));
  ln.requestPermissions.mockReset().mockImplementation(async () => ({ display: 'granted' }));
  ln.schedule.mockClear();
  ln.addListener.mockReset();
  ln.cancel.mockClear();
  ln.getPending.mockReset().mockResolvedValue({ notifications: [{ id: 7 }, { id: 9 }] });
  ln.removeAllDeliveredNotifications.mockReset().mockResolvedValue(undefined);
  setPrimerAllowed(true);
});

describe('local notifications', () => {
  it('explains first, then asks Android, then shows the notification', async () => {
    const p = showAlertNotifications([alert('a')]);
    await tick();
    expect(notificationPrimer.getSnapshot()).toBe(true);
    expect(ln.requestPermissions).not.toHaveBeenCalled(); // not before the parent has read why
    notificationPrimer.answer(true);
    await p;
    expect(ln.requestPermissions).toHaveBeenCalledTimes(1);
    expect(ln.schedule).toHaveBeenCalledTimes(1);
    const n = (ln.schedule.mock.calls[0] as unknown as [{ notifications: Array<{ title: string; extra: unknown }> }])[0].notifications;
    expect(n[0]).toMatchObject({ title: 'Title a', extra: { kind: 'summary', refId: 's-a' } });
  });

  it('shows nothing, and does not ask again, when the parent says not now', async () => {
    const p = showAlertNotifications([alert('a')]);
    await tick();
    notificationPrimer.answer(false);
    await p;
    expect(ln.schedule).not.toHaveBeenCalled();
    await showAlertNotifications([alert('b')]);
    expect(notificationPrimer.getSnapshot()).toBe(false);
    expect(ln.requestPermissions).not.toHaveBeenCalled();
  });

  it('skips quietly when Android permission is denied', async () => {
    ln.display = 'denied';
    await showAlertNotifications([alert('a')]);
    expect(notificationPrimer.getSnapshot()).toBe(false);
    expect(ln.schedule).not.toHaveBeenCalled();
  });

  it('skips quietly when the Android prompt is refused', async () => {
    ln.requestPermissions.mockResolvedValue({ display: 'denied' });
    const p = showAlertNotifications([alert('a')]);
    await tick();
    notificationPrimer.answer(true);
    await p;
    expect(ln.schedule).not.toHaveBeenCalled();
  });

  it('does not ask when already granted (Android 12 and below)', async () => {
    ln.display = 'granted';
    await showAlertNotifications([alert('a'), alert('b')]);
    expect(ln.requestPermissions).not.toHaveBeenCalled();
    expect((ln.schedule.mock.calls[0] as unknown as [{ notifications: unknown[] }])[0].notifications).toHaveLength(2);
  });

  it('bundles a burst of new alerts into one notification', async () => {
    ln.display = 'granted';
    await showAlertNotifications(['a', 'b', 'c', 'd', 'e'].map(alert));
    const n = (ln.schedule.mock.calls[0] as unknown as [{ notifications: Array<{ title: string }> }])[0].notifications;
    expect(n).toHaveLength(1);
    expect(n[0]!.title).toMatch(/5 new updates/);
  });

  it('routes a tapped notification to its screen', async () => {
    const go = vi.fn();
    let cb: ((e: unknown) => void) | undefined;
    ln.addListener.mockImplementation(async (_n: string, f: (e: unknown) => void) => {
      cb = f;
      return { remove: async () => {} };
    });
    onNotificationTap(go);
    await tick();
    cb!({ actionId: 'tap', notification: { extra: { kind: 'flag', refId: 'sess1' } } });
    expect(go).toHaveBeenCalledWith('/parent/sessions/sess1');
    cb!({ actionId: 'tap', notification: { extra: { kind: 'avatar_ready', refId: 'av1' } } });
    expect(go).toHaveBeenLastCalledWith('/parent/avatar');
  });

  it('holds the permission sheet back until the parent is somewhere calm', async () => {
    setPrimerAllowed(false); // e.g. mid avatar setup
    const p = showAlertNotifications([alert('a')]);
    await tick();
    expect(notificationPrimer.getSnapshot()).toBe(false);
    setPrimerAllowed(true); // back on Home
    await tick();
    expect(notificationPrimer.getSnapshot()).toBe(true);
    notificationPrimer.answer(true);
    await p;
    expect(ln.schedule).toHaveBeenCalledTimes(1);
  });
});

describe('sign-out clears notifications', () => {
  it('cancels pending and removes delivered ones', async () => {
    await clearNotifications();
    expect(ln.cancel).toHaveBeenCalledWith({ notifications: [{ id: 7 }, { id: 9 }] });
    expect(ln.removeAllDeliveredNotifications).toHaveBeenCalledTimes(1);
  });

  it('is part of clearSessionStorage (sign-out and account change)', async () => {
    await clearSessionStorage();
    expect(ln.removeAllDeliveredNotifications).toHaveBeenCalled();
    expect(ln.cancel).toHaveBeenCalled();
  });

  it('never throws when the plugin fails', async () => {
    ln.removeAllDeliveredNotifications.mockRejectedValue(new Error('nope'));
    ln.getPending.mockRejectedValueOnce(new Error('nope'));
    await expect(clearNotifications()).resolves.toBeUndefined();
  });

  it('drops a permission sheet that was still waiting', async () => {
    const p = showAlertNotifications([alert('a')]);
    await tick();
    expect(notificationPrimer.getSnapshot()).toBe(true);
    await clearNotifications();
    await p;
    expect(notificationPrimer.getSnapshot()).toBe(false);
    expect(ln.schedule).not.toHaveBeenCalled();
  });
});
