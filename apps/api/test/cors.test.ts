import { describe, it, expect } from 'vitest';
import { makeApp } from './helpers';
import prodWrangler from '../wrangler.toml?raw';
import { APP_ORIGINS } from '../src/index';

describe('CORS for the Capacitor WebView', () => {
  it('answers the preflight from https://localhost before the auth guard', async () => {
    const { request } = makeApp();
    const res = await request('/api/me', {
      method: 'OPTIONS',
      headers: { Origin: 'https://localhost', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://localhost');
    expect(res.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).toContain('authorization');
  });

  it('keeps Access-Control-Allow-Origin on error responses (401 from the auth guard)', async () => {
    const { request } = makeApp();
    const res = await request('/api/me', { headers: { Origin: 'https://localhost', Authorization: 'Bearer not-a-valid-token' } });
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://localhost');
    const anon = await request('/api/me', { headers: { Origin: 'capacitor://localhost' } });
    expect(anon.status).toBe(401);
    expect(anon.headers.get('Access-Control-Allow-Origin')).toBe('capacitor://localhost');
  });

  it('answers the hosted web build (judges in a browser)', async () => {
    const { request } = makeApp();
    const res = await request('/api/me', {
      method: 'OPTIONS',
      headers: { Origin: 'https://everthere-web.m-vamshikrishna22.workers.dev', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://everthere-web.m-vamshikrishna22.workers.dev');
  });

  it('does not allow other origins', async () => {
    const { request } = makeApp();
    const res = await request('/api/health', { headers: { Origin: 'https://evil.example' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

// The production azp allowlist lives in wrangler.toml [vars]; the suite runs on wrangler.test.toml, so read it raw.
describe('Clerk authorized parties (production wrangler.toml)', () => {
  const parties = (/^CLERK_AUTHORIZED_PARTIES\s*=\s*"([^"]*)"/m.exec(prodWrangler)?.[1] ?? '').split(',').map((x) => x.trim());

  it('accepts sessions from the iOS WebView (capacitor://localhost)', () => {
    expect(parties).toContain('capacitor://localhost');
  });

  it('lists every origin CORS allows, so no app gets past CORS only to fail sign-in', () => {
    for (const o of APP_ORIGINS) expect(parties).toContain(o);
  });
});
