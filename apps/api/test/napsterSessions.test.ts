import { describe, expect, it, vi } from 'vitest';
import { defaultNapsterDeleteSession } from '../src/napster/sessions';

// The notes record no DELETE /sessions/{id} body for an already-deleted id; the cascade deleter treats
// only "not found" shapes as gone and lets every other error abort the child delete.
function deleterWith(res: Response) {
  const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(res);
  return { deleter: defaultNapsterDeleteSession({ NAPSTER_API_KEY: 'k' }), restore: () => f.mockRestore() };
}
const j = (b: unknown, status: number) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

describe('defaultNapsterDeleteSession', () => {
  it('succeeds on a normal delete', async () => {
    const { deleter, restore } = deleterWith(new Response(null, { status: 204 }));
    await expect(deleter('s1')).resolves.toBeUndefined();
    restore();
  });

  it.each([
    ['404', j({ code: 'NotFound' }, 404)],
    ['400 SessionNotFound array body', j([{ code: 'SessionNotFound', description: 'gone', type: 11 }], 400)],
    ['400 ConnectionNotFound array body', j([{ code: 'ConnectionNotFound', description: 'gone', type: 11 }], 400)],
  ])('treats an already-gone session as success (%s)', async (_n, res) => {
    const { deleter, restore } = deleterWith(res);
    await expect(deleter('s1')).resolves.toBeUndefined();
    restore();
  });

  it.each([
    ['500 empty', new Response('', { status: 500 })],
    ['403 InactiveSubscription', j([{ code: 'InactiveSubscription', description: 'd', type: 11 }], 403)],
    ['400 unknown code', j([{ code: 'Something', description: 'd', type: 11 }], 400)],
  ])('still rejects on real errors (%s)', async (_n, res) => {
    const { deleter, restore } = deleterWith(res);
    await expect(deleter('s1')).rejects.toBeDefined();
    restore();
  });
});
