// Some flows finish a sign-in and then still have on-device setup to do (the demo teacher registers this tablet).
// The session screen must not read the device registration until that setup is done, or it would pick the wrong role.

let held: Promise<unknown> | null = null;
const MAX_HOLD_MS = 15_000;

/** Call BEFORE the sign-in completes. The hold always ends: when `p` settles, or after 15 s. */
export function holdSession(p: Promise<unknown>): void {
  const safe = p.then(() => undefined, () => undefined);
  const timeout = new Promise<void>((r) => setTimeout(r, MAX_HOLD_MS));
  const mine = Promise.race([safe, timeout]);
  held = mine;
  void mine.then(() => {
    if (held === mine) held = null;
  });
}

/** Resolves once any hold is over (immediately when there is none). */
export const sessionReady = (): Promise<unknown> => held ?? Promise.resolve();
