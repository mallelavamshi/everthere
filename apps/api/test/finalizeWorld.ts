import { vi } from 'vitest';
import { env } from 'cloudflare:workers';
import type { Env } from '../src/env';
import { seedRows } from './helpers';

export const NOW = Date.now();
export const MIN = 60_000;

export type Item = { role: 'User' | 'Assistant' | 'System'; text: string; timestamp: string };

export const ITEMS: Item[] = [
  { role: 'Assistant', text: 'Hi Bug, it is Mommy. Want to sing our song?', timestamp: '2026-11-18T10:00:00Z' },
  { role: 'User', text: 'I miss you. My knee hurts!', timestamp: '2026-11-18T10:00:05Z' },
  { role: 'Assistant', text: 'Twinkle twinkle little star...', timestamp: '2026-11-18T10:00:10Z' },
  { role: 'User', text: 'Okay. I feel better now.', timestamp: '2026-11-18T10:00:20Z' },
];

/** Napster fake: getSession returns a closed session with `cost` (null = not closed yet). */
export function fakeNapster(over: { cost?: number | null; items?: Item[]; status?: string } = {}) {
  return {
    getSession: vi.fn(async (_id: string) => ({
      status: over.status ?? (over.cost === null ? 'active' : 'closed'),
      cost: over.cost === undefined ? 0.42 : over.cost,
      closeReason: 'client',
      items: over.items ?? ITEMS,
    })),
    deleteConnection: vi.fn(async (_id: string) => undefined),
    getCompanion: vi.fn(async (_id: string) => ({ id: _id, status: 'processing' })),
    createAgent: vi.fn(async () => ({ id: 'agent-x' })),
    createConnection: vi.fn(),
    createCompanion: vi.fn(),
    patchAgent: vi.fn(),
    deleteAgent: vi.fn(),
    deleteCompanion: vi.fn(),
  };
}
export type FakeNapster = ReturnType<typeof fakeNapster>;

export const GOOD_SUMMARY = {
  summary: 'You sang Twinkle Twinkle and Mia calmed down. She told you her knee hurt.',
  moodSignal: 'better',
  flags: [] as { category: string; quote: string; severity: string }[],
};

/** Meta text fake whose chat() resolves to `out` (stringified when not a string). */
export function fakeMeta(out: unknown = GOOD_SUMMARY) {
  return { chat: vi.fn(async (_o: unknown) => (typeof out === 'string' ? out : JSON.stringify(out))) };
}

export const all = async <T = Record<string, any>>(sql: string, ...b: unknown[]) => (await env.DB.prepare(sql).bind(...b).all<T>()).results;
export const sessionRow = (id: string) => env.DB.prepare('SELECT * FROM comfort_session WHERE id = ?').bind(id).first<Record<string, any>>();
export const spent = async () => (await env.DB.prepare('SELECT spent_usd FROM credit_guard WHERE id = 1').first<{ spent_usd: number }>())!.spent_usd;
export const alertsFor = (sessionId: string) => all('SELECT * FROM alert WHERE ref_id = ? ORDER BY user_id', sessionId);

/**
 * Per-test world, ids prefixed `p`: org A (teacher T runs sessions, admin AD), family F (parents P "Pat Doe" and P2)
 * with child C "Mia Doe" at daycare A. Avatar av (owner P, "Mommy"). Child session s (napster `${p}conn`) and
 * test session st (owner P, napster `${p}tconn`), both started 5 minutes ago and still running.
 */
export async function world(p: string, over: { s?: Record<string, unknown>; st?: Record<string, unknown> } = {}) {
  const id = (x: string) => `${p}${x}`;
  await seedRows(env as Env, {
    user: [
      { id: id('P'), name: 'Pat Doe', email: `${id('P')}@x`, created_at: NOW },
      { id: id('P2'), name: 'Sam Doe', email: `${id('P2')}@x`, created_at: NOW },
      { id: id('T'), name: 'Tina Teacher', email: `${id('T')}@x`, created_at: NOW },
      { id: id('AD'), name: 'Ada Admin', email: `${id('AD')}@x`, created_at: NOW },
    ],
    org: [{ id: id('A'), name: 'Sunny Days' }],
    org_member: [
      { org_id: id('A'), user_id: id('T'), role: 'teacher' },
      { org_id: id('A'), user_id: id('AD'), role: 'admin' },
    ],
    family: [{ id: id('F'), created_at: 1 }],
    family_member: [
      { family_id: id('F'), user_id: id('P'), role: 'parent' },
      { family_id: id('F'), user_id: id('P2'), role: 'parent' },
    ],
    child: [{ id: id('C'), family_id: id('F'), name: 'Mia Doe' }],
    connection: [{ id: id('cn'), child_id: id('C'), kind: 'daycare', org_id: id('A'), transcript_access: 0 }],
    avatar: [{ id: id('av'), user_id: id('P'), status: 'approved', napster_agent_id: 'ag', parent_title: 'Mommy', created_at: NOW }],
    comfort_session: [
      {
        id: id('s'), napster_session_id: id('conn'), child_id: id('C'), avatar_id: id('av'), caregiver_user_id: id('T'),
        org_id: id('A'), reason: 'missing_parent', started_at: NOW - 5 * MIN, status: 'started', kind: 'child', ...over.s,
      },
      {
        id: id('st'), napster_session_id: id('tconn'), child_id: null, avatar_id: id('av'), caregiver_user_id: id('P'),
        started_at: NOW - 5 * MIN, status: 'active', kind: 'test', ...over.st,
      },
    ],
  });
  return { id };
}
