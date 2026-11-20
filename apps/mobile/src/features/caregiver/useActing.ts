import { useCallback, useEffect, useRef, useState } from 'react';
import { onActingReset } from '../../lib/actingReset';
import { getActingToken, type ActingToken } from '../../lib/storage';

// setTimeout takes a 32-bit delay; a 12 h token is far inside it, but never trust a stored value.
const MAX_DELAY = 2 ** 31 - 1;

/**
 * The shared tablet's current acting teacher (the 12 h token on device). `loaded` flips once storage has been read.
 * When the token runs out, `onExpire` fires once and `acting` becomes null (an expired token is never sent anyway).
 */
export function useActing(onExpire?: () => void) {
  const [acting, setActing] = useState<ActingToken | null>(null);
  const [loaded, setLoaded] = useState(false);
  const expire = useRef(onExpire);
  expire.current = onExpire;

  const reload = useCallback(async () => {
    const t = await getActingToken();
    setActing(t);
    setLoaded(true);
    return t;
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!acting) return;
    const id = setTimeout(() => {
      setActing(null);
      expire.current?.();
    }, Math.min(Math.max(acting.expiresAt - Date.now(), 0), MAX_DELAY));
    return () => clearTimeout(id);
  }, [acting]);

  /** Forget the in-memory teacher right now (the stored token is cleared by the caller). */
  const reset = useCallback(() => setActing(null), []);

  // unregisterDevice() resets whoever was teaching, wherever it is called from.
  useEffect(() => onActingReset(reset), [reset]);

  return { acting, loaded, reload, reset };
}
