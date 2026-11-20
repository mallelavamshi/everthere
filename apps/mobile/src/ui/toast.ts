// Tiny imperative toast store. Mount one <Toaster/> at the root; call toast.success(...) anywhere.

export type ToastKind = 'success' | 'error' | 'info';
export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  /** Replaces the kind's icon (e.g. 🎵 for "Singing…", so it is not shown beside 💡). */
  icon?: string;
}

export interface ToastOptions {
  icon?: string;
}

export const TOAST_MS = 3500;
export const TOAST_MAX = 3;

let items: ToastItem[] = [];
let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

function remove(id: number) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  const next = items.filter((i) => i.id !== id);
  if (next.length !== items.length) {
    items = next;
    emit();
  }
}

function push(kind: ToastKind, message: string, opts?: ToastOptions): number {
  const id = nextId++;
  items = [...items, opts?.icon ? { id, kind, message, icon: opts.icon } : { id, kind, message }];
  // Cap the stack: drop the oldest.
  while (items.length > TOAST_MAX) {
    const dropped = items[0]!;
    items = items.slice(1);
    const t = timers.get(dropped.id);
    if (t) clearTimeout(t);
    timers.delete(dropped.id);
  }
  timers.set(id, setTimeout(() => remove(id), TOAST_MS));
  emit();
  return id;
}

export const toast = {
  success: (message: string, opts?: ToastOptions) => push('success', message, opts),
  error: (message: string, opts?: ToastOptions) => push('error', message, opts),
  info: (message: string, opts?: ToastOptions) => push('info', message, opts),
  dismiss: remove,
  clear() {
    timers.forEach(clearTimeout);
    timers.clear();
    items = [];
    emit();
  },
};

export const toastStore = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  getSnapshot: () => items,
};
