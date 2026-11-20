import { describe, it, expect } from 'vitest';
import { assertClientId, childClientId, EXTERNAL_CLIENT_ID_RE, testClientId } from '../src/lib/clientIds';

// Expected values computed independently with Node: createHash('sha256').update(s).digest('base64url').
describe('Napster externalClientId derivation', () => {
  it('child: first 32 chars of base64url(SHA-256("child:" + id)), for a dotted demo id', async () => {
    const id = await childClientId('demo.child.mia');
    expect(id).toBe('OVd8KXDV2xJDmQ4-qt6oaytUE8HokQR8');
    expect(id).toMatch(EXTERNAL_CLIENT_ID_RE);
    expect(id).toHaveLength(32);
  });

  it('is stable per child and distinct between children', async () => {
    expect(await childClientId('demo.child.mia')).toBe(await childClientId('demo.child.mia'));
    expect(await childClientId('demo.child.mia')).not.toBe(await childClientId('demo.child.leo'));
  });

  it('test call: "t_" + first 30 chars of base64url(SHA-256("avatar:" + id))', async () => {
    const id = await testClientId('demo.av.mia.mommy');
    expect(id).toBe('t_llV_-OMwiCT4XY9YEBXPGWhxCEXmSo');
    expect(id).toMatch(EXTERNAL_CLIENT_ID_RE);
    expect(id).toHaveLength(32);
  });

  it('never leaks the raw app id and always matches the Napster pattern, whatever the input', async () => {
    for (const raw of ['', 'a', 'x'.repeat(500), 'ünï cødé/+=.', 'Jby8z0Gc6F5I4O_M_jybe']) {
      const c = await childClientId(raw);
      const t = await testClientId(raw);
      expect(c).toMatch(EXTERNAL_CLIENT_ID_RE);
      expect(t).toMatch(EXTERNAL_CLIENT_ID_RE);
      if (raw.length > 3) expect(c).not.toContain(raw);
    }
  });

  it('assertClientId throws on an invalid value', () => {
    expect(() => assertClientId('demo.child.mia')).toThrow();
    expect(() => assertClientId('x'.repeat(33))).toThrow();
    expect(assertClientId('ok_id-1')).toBe('ok_id-1');
  });
});
