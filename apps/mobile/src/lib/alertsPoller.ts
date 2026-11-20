import type { QueryClient } from '@tanstack/react-query';
import type { AlertView } from '@everthere/shared';
import { api } from './api';
import { routeForAlert } from './alertsRoute';
import { loadSeenState, saveSeen } from './alertsSeen';
import { onAppBackground, onAppResume } from './native';
import { showAlertNotifications } from './notifications';
import { qk } from './queries';

export const POLL_MS = 30_000;

export { routeForAlert };

export interface Lifecycle {
  onBackground(cb: () => void): () => void;
  onResume(cb: () => void): () => void;
}

export interface PollerDeps {
  userId: string;
  fetchUnread: () => Promise<AlertView[]>;
  /** Show a notification for alerts this device has not shown before. */
  notify: (fresh: AlertView[]) => Promise<void>;
  /** Every poll result, new or not: keeps the bell badge in step. */
  onAlerts?: (all: AlertView[]) => void;
  lifecycle?: Lifecycle;
  intervalMs?: number;
}

export interface AlertsPoller {
  /** Poll now and every `intervalMs` while the app is in the foreground. */
  start(): void;
  stop(): void;
  /** One poll. Never rejects. Overlapping calls share one request. */
  pollNow(): Promise<void>;
}

const defaultLifecycle: Lifecycle = { onBackground: onAppBackground, onResume: onAppResume };

/**
 * Polls the caller's unread alerts while the app is in the foreground (30 s), straight away on resume, and not at
 * all while backgrounded. Alerts whose ids were already notified (kept on-device, capped) are not notified again.
 */
export function createAlertsPoller(deps: PollerDeps): AlertsPoller {
  const interval = deps.intervalMs ?? POLL_MS;
  const life = deps.lifecycle ?? defaultLifecycle;
  let timer: ReturnType<typeof setInterval> | null = null;
  let offBg: (() => void) | null = null;
  let offResume: (() => void) | null = null;
  let running = false;
  let paused = false;
  let inFlight: Promise<void> | null = null;
  /** Bumped by stop(): a poll that started before it must not touch anything afterwards. */
  let epoch = 0;

  async function poll(): Promise<void> {
    const mine = epoch;
    try {
      const all = await deps.fetchUnread();
      if (mine !== epoch) return; // signed out (or stopped) while the request was out: touch nothing
      deps.onAlerts?.(all);
      const stored = await loadSeenState(deps.userId);
      if (mine !== epoch) return;
      if (stored === null) {
        // First poll for this person on this device: what is already there is not news. Learn it, say nothing.
        await saveSeen(deps.userId, all.map((a) => a.id));
        return;
      }
      const seen = stored;
      const known = new Set(seen);
      const fresh = all.filter((a) => !known.has(a.id));
      if (!fresh.length) return;
      // Remember first: a notification that fails (permission denied) must not come back every 30 seconds.
      await saveSeen(deps.userId, [...seen, ...fresh.map((a) => a.id)]);
      // Not awaited: a notification waiting on the permission sheet must not stall polling.
      void deps.notify(fresh).catch(() => {});
    } catch {
      /* offline or a hiccup: the next poll tries again */
    }
  }

  const pollNow = (): Promise<void> => {
    inFlight ??= poll().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const arm = () => {
    if (timer) clearInterval(timer);
    timer = setInterval(() => void pollNow(), interval);
  };
  const disarm = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  return {
    pollNow,
    start() {
      if (running) return;
      running = true;
      paused = false;
      offBg = life.onBackground(() => {
        if (!running || paused) return;
        paused = true;
        disarm();
      });
      offResume = life.onResume(() => {
        if (!running || !paused) return; // already going: a repeat of the same resume
        paused = false;
        void pollNow();
        arm();
      });
      void pollNow();
      arm();
    },
    stop() {
      running = false;
      epoch += 1;
      inFlight = null;
      disarm();
      offBg?.();
      offResume?.();
      offBg = offResume = null;
    },
  };
}

// ---- the app's one poller ---------------------------------------------------------------------------------------

let active: AlertsPoller | null = null;

/** Start polling for `userId` (replacing any poller for someone else). Results also feed the unread-alerts query. */
export function startAlertsPoller(userId: string, qc: QueryClient): void {
  stopAlertsPoller();
  active = createAlertsPoller({
    userId,
    fetchUnread: () => api<{ items: AlertView[] }>('/alerts?unread=1').then((r) => r.items ?? []),
    onAlerts: (items) => qc.setQueryData(qk.alerts(true), items),
    notify: showAlertNotifications,
  });
  active.start();
}

export function stopAlertsPoller(): void {
  active?.stop();
  active = null;
}
