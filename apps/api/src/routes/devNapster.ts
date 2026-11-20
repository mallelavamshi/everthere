import { Hono } from 'hono';
import type { AppEnv, Env } from '../env';
import { apiError } from '../http';
import { napster as makeNapster } from '../napster/client';
import { type SessionNapster } from '../services/sessions';
import { assertClientId } from '../lib/clientIds';

/** Short, stable, non-reversible tag for a user id (hex SHA-256 prefix). */
async function userIdHash(userId: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

/**
 * Device-spike helper (Task 4): mints a Napster WebRTC token for the throwaway SPIKE_AGENT_ID.
 * Exists only when env.DEV_ROUTES === '1'; otherwise it answers exactly like an unknown route (404).
 * Clerk auth applies as for every other /api route (blanket guard in index.ts).
 */
export function devNapsterRoutes(opts: { napster?: SessionNapster } = {}) {
  const r = new Hono<AppEnv>();
  const client = (env: Env): SessionNapster => opts.napster ?? makeNapster(env.NAPSTER_API_KEY);

  r.use('/dev/*', async (c, next) => {
    if (c.env.DEV_ROUTES !== '1') throw apiError('NOT_FOUND', 'Not found');
    await next();
  });

  r.post('/dev/napster-token', async (c) => {
    const agentId = c.env.SPIKE_AGENT_ID;
    if (!agentId) throw apiError('INTERNAL', 'SPIKE_AGENT_ID is not configured');
    const externalClientId = assertClientId(`spike_${await userIdHash(c.var.userId)}`);
    const { token, connectionId } = await client(c.env).createConnection(agentId, {
      channelType: 'webrtc',
      externalClientId,
      initialSpeech: 'Hi, I am Spike. How are you today?',
    });
    return c.json({ token, connectionId });
  });

  return r;
}
