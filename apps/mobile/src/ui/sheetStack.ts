import { useSyncExternalStore } from 'react';

// Registry of open bottom sheets. The Android hardware-back handler (Task 17) calls
// sheetStack.closeTop() first; if it returns true the back press was consumed by a sheet.

interface Entry {
  id: number;
  close: () => void;
  /** Locks the page behind it (true for real sheets). A back guard registers with lock: false. */
  lock: boolean;
}

// Page lock while any sheet is open: body scroll is locked and the app root is made inert + aria-hidden.
// Applied once when the first sheet registers and released when the last unregisters (reference counted
// by stack length), so stacked sheets cannot restore each other's stale state.
let saved: { overflow: string; root: HTMLElement | null; inert: boolean; ariaHidden: string | null } | null = null;

function lockPage() {
  if (typeof document === 'undefined') return;
  const root = document.getElementById('root');
  saved = { overflow: document.body.style.overflow, root, inert: !!root?.hasAttribute('inert'), ariaHidden: root?.getAttribute('aria-hidden') ?? null };
  document.body.style.overflow = 'hidden';
  root?.setAttribute('inert', '');
  root?.setAttribute('aria-hidden', 'true');
}

function unlockPage() {
  if (!saved) return;
  document.body.style.overflow = saved.overflow;
  const { root } = saved;
  if (root) {
    if (!saved.inert) root.removeAttribute('inert');
    if (saved.ariaHidden === null) root.removeAttribute('aria-hidden');
    else root.setAttribute('aria-hidden', saved.ariaHidden);
  }
  saved = null;
}

let nextId = 1;
let stack: Entry[] = [];
const listeners = new Set<() => void>();
let snapshot = 0;

function emit() {
  snapshot++;
  listeners.forEach((l) => l());
}

export const sheetStack = {
  /**
   * Register an open sheet; returns { id, unregister }. Pass `{ lock: false }` for a back-button guard that is not a
   * visible sheet (e.g. an unsaved-changes form): Android back then calls `close`, and the page stays interactive.
   */
  register(close: () => void, opts: { lock?: boolean } = {}): { id: number; unregister: () => void } {
    const entry: Entry = { id: nextId++, close, lock: opts.lock !== false };
    if (entry.lock && !stack.some((e) => e.lock)) lockPage();
    stack = [...stack, entry];
    emit();
    return {
      id: entry.id,
      unregister: () => {
        stack = stack.filter((e) => e !== entry);
        if (entry.lock && !stack.some((e) => e.lock)) unlockPage();
        emit();
      },
    };
  },
  size: () => stack.length,
  isTop: (id: number) => stack[stack.length - 1]?.id === id,
  /** Closes the topmost sheet. Returns true when a sheet was open (back press handled). */
  closeTop(): boolean {
    const top = stack[stack.length - 1];
    if (!top) return false;
    top.close();
    return true;
  },
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  getSnapshot: () => snapshot,
};

/** React view of the registry: { open, count, closeTop }. */
export function useSheetStack() {
  useSyncExternalStore(sheetStack.subscribe, sheetStack.getSnapshot, sheetStack.getSnapshot);
  return { open: stack.length > 0, count: stack.length, closeTop: sheetStack.closeTop };
}
