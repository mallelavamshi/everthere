import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { apiError } from '../http';
import { hmacHexBytes, timingSafeEqualHex } from '../lib/crypto';
import { finalizeSession, markEndedStmt, type FinalizeDeps } from '../services/finalize';

const utf8 = new TextEncoder();

function base64Bytes(s: string): Uint8Array | null {
  const t = s.trim();
  if (!t || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(t)) return null;
  try {
    return Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Napster `X-Webhook-Signature`: hex HMAC-SHA256 of the raw body. The dashboard shows the signing secret
 * base64-encoded, so both the decoded bytes and the raw UTF-8 string are accepted as the key (confirmed against a
 * live delivery later). An optional `sha256=` prefix and upper-case hex are tolerated. Constant-time comparison.
 */
export async function verifyNapsterSignature(secret: string | undefined, rawBody: string, header: string | null | undefined): Promise<boolean> {
  if (!secret || !header) return false;
  const given = header.trim().replace(/^sha256=/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  const keys = [base64Bytes(secret), utf8.encode(secret)].filter((k): k is Uint8Array => k != null && k.length > 0);
  let ok = false;
  for (const k of keys) ok = timingSafeEqualHex(await hmacHexBytes(k, rawBody), given) || ok;
  return ok;
}

const Envelope = z.object({
  eventId: z.string().min(1).max(200),
  eventType: z.string().max(200),
  data: z.unknown().optional(),
});

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const idStr = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : null);

/** ISO string, unix seconds or unix ms → epoch ms; NaN when absent or unreadable. */
function toEpochMs(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string' && v) return /^\d+(\.\d+)?$/.test(v) ? toEpochMs(Number(v)) : Date.parse(v);
  return NaN;
}

/**
 * The session a `session.closed` event is about. The body Napster actually sends did not match `data.session.id`
 * alone (device test I-1), so every shape seen in Napster's payloads is accepted: `data.session.id`,
 * `data.session.connectionId`, `data.connectionId`, `data.sessionId` and `data.id`. Each candidate is matched
 * against `comfort_session.napster_session_id` (which holds the connection id = Napster's REST session id).
 */
export function parseClosedData(data: unknown): { ids: string[]; closedAtMs: number } | null {
  if (!isObj(data)) return null;
  const session = isObj(data.session) ? data.session : undefined;
  const ids = [session?.id, session?.connectionId, data.connectionId, data.sessionId, data.id]
    .map(idStr)
    .filter((v): v is string => v != null);
  if (!ids.length) return null;
  return { ids: [...new Set(ids)], closedAtMs: toEpochMs(session?.closedAt ?? data.closedAt) };
}

/** Key names only (never values) of an unusable payload, one level into `session`, for a single diagnostic log line. */
function keysOf(data: unknown): string {
  if (!isObj(data)) return Array.isArray(data) ? '<array>' : `<${data === null ? 'null' : typeof data}>`;
  return Object.keys(data)
    .slice(0, 40)
    .map((k) => (isObj(data[k]) ? `${k}{${Object.keys(data[k] as object).slice(0, 40).join(',')}}` : k))
    .join(',');
}

export function webhookRoutes(deps: FinalizeDeps = {}) {
  const r = new Hono<AppEnv>();

  r.post('/webhooks/napster', async (c) => {
    // Verify over the exact raw bytes before parsing anything.
    const raw = await c.req.text();
    if (!(await verifyNapsterSignature(c.env.NAPSTER_WEBHOOK_SECRET, raw, c.req.header('X-Webhook-Signature')))) {
      throw apiError('UNAUTHENTICATED', 'Invalid webhook signature');
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw apiError('INVALID', 'Invalid JSON body');
    }
    const ev = Envelope.safeParse(body);
    if (!ev.success) throw apiError('INVALID', 'Not a webhook event');

    // Napster retries up to 3 times: the first delivery of an eventId wins, later ones are acknowledged and dropped.
    const now = Date.now();
    const eventId = ev.data.eventId;
    const recordEvent = () =>
      c.env.DB.prepare('INSERT OR IGNORE INTO webhook_event (event_id, received_at) VALUES (?, ?)').bind(eventId, now);
    const ack = async () => {
      const ins = await recordEvent().run();
      return c.json(ins.meta.changes ? { ok: true } : { ok: true, duplicate: true });
    };

    // session.started, companion.* and anything unknown: record and acknowledge.
    if (ev.data.eventType !== 'session.closed') return ack();

    const data = parseClosedData(ev.data.data);
    if (!data) {
      console.warn('napster webhook: session.closed without a usable session', eventId, 'data keys:', keysOf(ev.data.data));
      return ack();
    }
    // comfort_session.napster_session_id holds the connection id, which Napster uses as the session id.
    const s = await c.env.DB
      .prepare(`SELECT id, status FROM comfort_session WHERE napster_session_id IN (${data.ids.map(() => '?').join(',')}) LIMIT 1`)
      .bind(...data.ids)
      .first<{ id: string; status: string }>();
    // Unknown sessions, and failed starts (never finalized or alerted, as in the cron sweep): record and acknowledge.
    if (!s || s.status === 'failed') return ack();

    // Record the event and the end in one batch: if either fails, nothing is recorded and Napster's retry is processed.
    // Marking the end right away lets the cron sweep finish the job if finalizing fails below.
    const closedAt = data.closedAtMs;
    const endedAt = Number.isFinite(closedAt) && closedAt <= now ? closedAt : now;
    const [ins] = await c.env.DB.batch([recordEvent(), markEndedStmt(c.env, s.id, endedAt, 'napster_closed')]);
    if (!ins!.meta.changes) return c.json({ ok: true, duplicate: true });

    const work = finalizeSession(c.env, s.id, deps).catch((e) => console.error('finalizeSession failed', s.id, e));
    let ctx: { waitUntil(p: Promise<unknown>): void } | undefined;
    try {
      ctx = c.executionCtx;
    } catch {
      ctx = undefined; // no ExecutionContext (tests): finish inline
    }
    if (ctx) ctx.waitUntil(work);
    else await work;
    return c.json({ ok: true });
  });

  return r;
}
