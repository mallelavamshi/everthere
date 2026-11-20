import { describe, it, expect } from 'vitest';
import { makeApp, authAs } from './helpers';
import { createApp } from '../src/index';
import { testVerify, testFetchProfile } from './helpers';

type Conn = { agentId: string; b: { channelType: string; externalClientId?: string } };

function fakeNapster(calls: Conn[]) {
  return {
    createConnection: async (agentId: string, b: Conn['b']) => {
      calls.push({ agentId, b });
      return { token: 'tok_1', connectionId: 'conn_1' };
    },
    deleteConnection: async () => undefined,
  } as never;
}

describe('POST /api/dev/napster-token', () => {
  it('is absent (404) when DEV_ROUTES is not 1', async () => {
    const calls: Conn[] = [];
    const { request } = makeApp({ napster: fakeNapster(calls) });
    const res = await request('/api/dev/napster-token', { method: 'POST', headers: authAs('u-dev-1') });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    expect(calls).toHaveLength(0);
  });

  it('with DEV_ROUTES=1: requires auth, then returns {token, connectionId} for SPIKE_AGENT_ID', async () => {
    const calls: Conn[] = [];
    const { env } = makeApp();
    const app = createApp({ verify: testVerify, fetchProfile: testFetchProfile, napster: fakeNapster(calls) });
    const devEnv = { ...env, DEV_ROUTES: '1', SPIKE_AGENT_ID: 'agent_spike' };

    const anon = await app.request('/api/dev/napster-token', { method: 'POST' }, devEnv);
    expect(anon.status).toBe(401);

    const res = await app.request('/api/dev/napster-token', { method: 'POST', headers: authAs('u-dev-2') }, devEnv);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: 'tok_1', connectionId: 'conn_1' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.agentId).toBe('agent_spike');
    expect(calls[0]!.b.channelType).toBe('webrtc');
    expect(calls[0]!.b.externalClientId).toMatch(/^spike_[0-9a-f]{24}$/);
    expect(calls[0]!.b.externalClientId).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
  });
});
