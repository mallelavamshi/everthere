// Whoever holds in-memory acting state (the roster's useActing) subscribes here; unregistering the tablet emits, so
// no caller of unregisterDevice has to remember to reset it.

const listeners = new Set<() => void>();

export const onActingReset = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
export const emitActingReset = (): void => listeners.forEach((l) => l());
