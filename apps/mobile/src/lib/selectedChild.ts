import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { Preferences } from '@capacitor/preferences';

// The parent's chosen child, shared by Home, Sessions and Caregivers and remembered on-device.
const KEY = 'everthere.selectedChild';
let current: string | null = null;
let hydrated = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const { value } = await Preferences.get({ key: KEY });
    if (value && current === null) {
      current = value;
      emit();
    }
  } catch {
    /* a remembered choice is a nicety */
  }
}

export function setSelectedChild(id: string | null): void {
  hydrated = true;
  if (id === current) return;
  current = id;
  emit();
  void (async () => {
    try {
      if (id) await Preferences.set({ key: KEY, value: id });
      else await Preferences.remove({ key: KEY });
    } catch {
      /* ignore */
    }
  })();
}

/** Forget the choice: in-memory value, hydrated flag and the stored key. Run on sign-out and on an account change. */
export async function clearSelectedChild(): Promise<void> {
  current = null;
  hydrated = false;
  emit();
  try {
    await Preferences.remove({ key: KEY });
  } catch {
    /* ignore */
  }
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/** [selected id or null, setter]. Callers fall back to the first child when the id is null or no longer exists. */
export function useSelectedChild(): [string | null, (id: string | null) => void] {
  const id = useSyncExternalStore(subscribe, () => current, () => null);
  useEffect(() => {
    void hydrate();
  }, []);
  return [id, useCallback(setSelectedChild, [])];
}
