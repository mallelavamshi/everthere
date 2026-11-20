import { api } from '../../lib/api';

/** The API accepts at most this many ids per request (D1 limits bound parameters). */
export const MAX_READ_IDS = 90;

/** Marks alerts read, splitting into requests of at most 90 ids. Returns how many the server updated. */
export async function markAlertsRead(ids: string[]): Promise<number> {
  const unique = [...new Set(ids)];
  let updated = 0;
  for (let i = 0; i < unique.length; i += MAX_READ_IDS) {
    const r = await api<{ updated?: number }>('/alerts/read', { method: 'POST', json: { ids: unique.slice(i, i + MAX_READ_IDS) } });
    updated += r?.updated ?? 0;
  }
  return updated;
}
