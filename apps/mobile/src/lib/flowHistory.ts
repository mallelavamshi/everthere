import type { NavigateFunction } from 'react-router-dom';

/**
 * Keeps the avatar set-up flow (photo -> voice -> consent -> creating -> test call -> approve) from lingering in the
 * history after it is done: Android back from home used to walk into the stale set-up and test screens (device test
 * M-8). AvatarSetup marks the history position where the flow starts; once the avatar is approved, leaveFlow rewinds
 * to just before that position and replaces it with home. React Router's BrowserRouter keeps that position in
 * `history.state.idx`. Anything unexpected (no record, another avatar, a stale record) falls back to a plain replace.
 */

const KEY = 'everthere.avatarFlow';
const MAX_AGE_MS = 60 * 60_000;

type Rec = { start: number; at: number; avatarId?: string };

const currentIdx = (): number | null => {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' && Number.isInteger(idx) ? idx : null;
};

function read(): Rec | null {
  try {
    const r = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Rec | null;
    return r && typeof r.start === 'number' && typeof r.at === 'number' ? r : null;
  } catch {
    return null;
  }
}

function write(r: Rec): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    /* storage unavailable: leaveFlow falls back to a plain replace */
  }
}

export function clearFlow(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** The flow's first history entry is the current one (AvatarSetup on mount). */
export function markFlowStart(): void {
  const idx = currentIdx();
  if (idx == null) return clearFlow();
  write({ start: idx, at: Date.now() });
}

/** The flow produced this avatar (only a bound flow is ever rewound, so an abandoned set-up never is). */
export function bindFlowAvatar(avatarId: string): void {
  const r = read();
  if (r) write({ ...r, avatarId });
}

/** Leave the finished flow for `home`, dropping the flow's history entries when we can tell exactly where they are. */
export function leaveFlow(avatarId: string, navigate: NavigateFunction, home: string): void {
  const r = read();
  clearFlow();
  const idx = currentIdx();
  const usable = r && r.avatarId === avatarId && Date.now() - r.at < MAX_AGE_MS && idx != null && r.start >= 1 && idx >= r.start;
  if (!usable) {
    navigate(home, { replace: true });
    return;
  }
  const onPop = () => {
    window.removeEventListener('popstate', onPop);
    navigate(home, { replace: true });
  };
  window.addEventListener('popstate', onPop);
  window.history.go(-(idx - r.start + 1));
}
