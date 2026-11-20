// Build-time guards for the Android release (used by vite.config.ts). A release that talks to a local API would ship
// a dead app, so a production build refuses to start without a real VITE_API_BASE.

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '10.0.2.2'];

export function assertReleaseApiBase(mode: string, apiBase: string | undefined): void {
  if (mode !== 'production') return;
  const base = (apiBase ?? '').trim();
  if (!base) {
    throw new Error('VITE_API_BASE is not set. A production build needs the deployed API URL, e.g. VITE_API_BASE=https://everthere-api.<account>.workers.dev');
  }
  const lower = base.toLowerCase();
  const local = LOCAL_HOSTS.find((h) => lower.includes(h));
  if (local) {
    throw new Error(`VITE_API_BASE points at ${local} (${base}). A production build needs the deployed API URL, not a local one.`);
  }
}

/** Vite `build` options per mode: no source maps in the shipped app. */
export const buildOptions = (mode: string) => ({ outDir: 'dist', sourcemap: mode !== 'production' });
