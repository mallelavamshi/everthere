import type { AlertView } from '@everthere/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAlertsPoller, POLL_MS, routeForAlert, type Lifecycle } from '../src/lib/alertsPoller';
import { clearSeen, loadSeen, loadSeenState, saveSeen, SEEN_CAP } from '../src/lib/alertsSeen';
import { clearSessionStorage } from '../src/lib/storage';

const alert = (id: string, over: Partial<AlertView> = {}): AlertView => ({ id, kind: 'summary', refId: `s-${id}`, title: `t ${id}`, body: 'b', readAt: null, createdAt: 1, ...over });

function fakeLifecycle() {
  let bg: (() => void) | null = null;
  let resume: (() => void) | null = null;
  const lc: Lifecycle = {
    onBackground: (cb) => {
      bg = cb;
      return () => {
        bg = null;
      };
    },
    onResume: (cb) => {
      resume = cb;
      return () => {
        resume = null;
      };
    },
  };
  return { lc, background: () => bg?.(), resume: () => resume?.(), wired: () => !!bg && !!resume };
}

const pendingSeed: Promise<void>[] = [];
beforeEach(async () => {
  pendingSeed.length = 0;
  vi.useFakeTimers();
  await clearSeen();
});
afterEach(() => {
  vi.useRealTimers();
});

/** `seeded`: the person has polled before (an empty seen list is stored), so everything unseen is news. */
function setup(initial: AlertView[], userId = 'u1', seeded = true) {
  if (seeded) pendingSeed.push(saveSeen(userId, []));
  let current = initial;
  const fetchUnread = vi.fn(async () => current);
  const notify = vi.fn(async (_a: AlertView[]) => {});
  const onAlerts = vi.fn();
  const life = fakeLifecycle();
  const real = createAlertsPoller({ userId, fetchUnread, notify, onAlerts, lifecycle: life.lc });
  const poller = { ...real, pollNow: async () => { await Promise.all(pendingSeed); return real.pollNow(); }, start: () => { void Promise.all(pendingSeed).then(() => real.start()); }, stop: real.stop };
  return {
    poller,
    fetchUnread,
    notify,
    onAlerts,
    life,
    set: (a: AlertView[]) => {
      current = a;
    },
  };
}

describe('alertsPoller', () => {
  it('notifies only alerts it has not seen before (Review Focus 5)', async () => {
    const t = setup([alert('a'), alert('b')]);
    await t.poller.pollNow();
    expect(t.notify).toHaveBeenCalledTimes(1);
    expect(t.notify.mock.calls[0]![0].map((a) => a.id)).toEqual(['a', 'b']);

    t.set([alert('a'), alert('b'), alert('c')]);
    await t.poller.pollNow();
    expect(t.notify).toHaveBeenCalledTimes(2);
    expect(t.notify.mock.calls[1]![0].map((a) => a.id)).toEqual(['c']);

    await t.poller.pollNow(); // nothing new
    expect(t.notify).toHaveBeenCalledTimes(2);
  });

  it('remembers seen ids across poller instances (an app restart does not re-notify)', async () => {
    const a = setup([alert('a')]);
    await a.poller.pollNow();
    const b = setup([alert('a')], 'u1', false);
    await b.poller.pollNow();
    expect(b.notify).not.toHaveBeenCalled();
  });

  it('keeps seen ids per user', async () => {
    await setup([alert('a')], 'u1').poller.pollNow();
    const other = setup([alert('a')], 'u2');
    await other.poller.pollNow();
    expect(other.notify).toHaveBeenCalledTimes(1);
  });

  it('hands every poll result to onAlerts so the bell badge stays current', async () => {
    const t = setup([alert('a')]);
    await t.poller.pollNow();
    expect(t.onAlerts).toHaveBeenCalledWith([expect.objectContaining({ id: 'a' })]);
  });

  it('polls immediately on start, then every 30 seconds', async () => {
    const t = setup([]);
    t.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.fetchUnread).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(t.fetchUnread).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(t.fetchUnread).toHaveBeenCalledTimes(4);
    t.poller.stop();
  });

  it('pauses on background and polls again straight away on resume', async () => {
    const t = setup([]);
    t.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.fetchUnread).toHaveBeenCalledTimes(1);

    t.life.background();
    await vi.advanceTimersByTimeAsync(POLL_MS * 4);
    expect(t.fetchUnread).toHaveBeenCalledTimes(1); // nothing while hidden

    t.life.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.fetchUnread).toHaveBeenCalledTimes(2); // immediate
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(t.fetchUnread).toHaveBeenCalledTimes(3); // and the cadence is back
    t.poller.stop();
  });

  it('a double resume does not double the cadence', async () => {
    const t = setup([]);
    t.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    t.life.background();
    t.life.resume();
    t.life.resume();
    await vi.advanceTimersByTimeAsync(0);
    const base = t.fetchUnread.mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(t.fetchUnread.mock.calls.length).toBe(base + 1);
    t.poller.stop();
  });

  it('stop() ends the timer and unhooks the lifecycle', async () => {
    const t = setup([]);
    t.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    t.poller.stop();
    expect(t.life.wired()).toBe(false);
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(t.fetchUnread).toHaveBeenCalledTimes(1);
  });

  it('a failed poll is skipped quietly and the next one still runs', async () => {
    const t = setup([alert('a')]);
    t.fetchUnread.mockRejectedValueOnce(new Error('offline'));
    await expect(t.poller.pollNow()).resolves.toBeUndefined();
    await t.poller.pollNow();
    expect(t.notify).toHaveBeenCalledTimes(1);
  });

  it('does not double-notify when two polls overlap', async () => {
    const t = setup([alert('a')]);
    await Promise.all([t.poller.pollNow(), t.poller.pollNow()]);
    expect(t.notify).toHaveBeenCalledTimes(1);
  });

  it('does not wait for a notification that is stuck on the permission sheet', async () => {
    const t = setup([alert('a')]);
    t.notify.mockImplementation(() => new Promise<void>(() => {})); // never resolves
    await expect(t.poller.pollNow()).resolves.toBeUndefined();
    t.set([alert('a'), alert('b')]);
    await expect(t.poller.pollNow()).resolves.toBeUndefined();
    expect(t.notify).toHaveBeenCalledTimes(2);
  });

  it('marks ids seen even if showing the notification fails', async () => {
    const t = setup([alert('a')]);
    t.notify.mockRejectedValueOnce(new Error('denied'));
    await t.poller.pollNow();
    await t.poller.pollNow();
    expect(t.notify).toHaveBeenCalledTimes(1);
  });
});

describe('seen ids', () => {
  it('are capped at 200, newest kept', async () => {
    const ids = Array.from({ length: 230 }, (_, i) => `id${i}`);
    await saveSeen('u1', ids);
    const back = await loadSeen('u1');
    expect(back).toHaveLength(SEEN_CAP);
    expect(back[0]).toBe('id30');
    expect(back.at(-1)).toBe('id229');
  });

  it('stay capped when a poller keeps adding', async () => {
    await saveSeen('u1', Array.from({ length: 200 }, (_, i) => `old${i}`));
    const t = setup([alert('n1'), alert('n2')], 'u1', false);
    await t.poller.pollNow();
    const back = await loadSeen('u1');
    expect(back).toHaveLength(200);
    expect(back).toContain('n2');
    expect(back).not.toContain('old0');
  });

  it('are cleared on sign-out with the other per-user storage', async () => {
    await saveSeen('u1', ['a', 'b']);
    await clearSessionStorage();
    expect(await loadSeenState('u1')).toBeNull();
    expect(await loadSeen('u1')).toEqual([]);
  });

  it('a first poll seeds the seen list and does not notify for what is already there', async () => {
    const t = setup([alert('a'), alert('b')], 'u1', false);
    await t.poller.pollNow();
    expect(t.notify).not.toHaveBeenCalled();
    expect(await loadSeen('u1')).toEqual(['a', 'b']);
    t.set([alert('a'), alert('b'), alert('c')]);
    await t.poller.pollNow();
    expect(t.notify).toHaveBeenCalledTimes(1);
    expect(t.notify.mock.calls[0]![0].map((a) => a.id)).toEqual(['c']);
  });

  it('after sign-out the next person starts with a silent first poll', async () => {
    await saveSeen('u1', ['a']);
    await clearSessionStorage();
    const t = setup([alert('a')], 'u1', false);
    await t.poller.pollNow();
    expect(t.notify).not.toHaveBeenCalled();
  });
});

describe('notification tap routing', () => {
  it('opens the session for a summary or flag, the avatar for avatar_ready', () => {
    expect(routeForAlert('summary', 's1')).toBe('/parent/sessions/s1');
    expect(routeForAlert('flag', 's2')).toBe('/parent/sessions/s2');
    expect(routeForAlert('avatar_ready', 'a1')).toBe('/parent/avatar');
    expect(routeForAlert('invite', 'x')).toBe('/parent/caregivers');
  });
  it('falls back to the alerts list when there is nothing to open', () => {
    expect(routeForAlert('summary', null)).toBe('/parent/alerts');
    expect(routeForAlert('mystery', 'z')).toBe('/parent/alerts');
  });
  it('encodes the id', () => {
    expect(routeForAlert('summary', 'a/b')).toBe('/parent/sessions/a%2Fb');
  });
});
