import { FLAG_CATEGORIES, SEVERITIES, type FlagCategory, type Severity } from '@everthere/shared';
import type { SessionEvent } from './sessionMachine';

// Parsers for the real Napster `onData` frames captured in docs/notes/napster-events.md (section 2).

/** `onData` payload: `{ event, data? }`. Kept loose on purpose: frames vary by event. */
export interface LiveEvent {
  event: string;
  data?: Record<string, unknown> | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export type CaptionEvent = Extract<SessionEvent, { type: 'CAPTION' }>;

/**
 * Caption rule (notes, section 2): only `message_received` frames with `type:"message"` and a role of
 * `assistant` or `user` carry caption text. `delta` frames append per `item_id`; `completed` (and a user's
 * `created`, which already has the full text) replace it. Session, response-level and function_call frames are skipped.
 */
export function parseCaption(msg: LiveEvent): CaptionEvent | null {
  if (msg.event !== 'message_received' || !isObj(msg.data)) return null;
  const m = msg.data.message;
  if (!isObj(m) || m.type !== 'message') return null;
  const role = m.role === 'assistant' ? 'avatar' : m.role === 'user' ? 'child' : null;
  if (!role) return null;
  const content = str(m.content);
  if (!content) return null;
  const id = str(m.item_id) ?? str(m.response_id);
  if (!id) return null;
  const action = str(m.action);
  if (action === 'delta') return { type: 'CAPTION', id, role, text: content, mode: 'append' };
  if (action === 'completed' || action === 'created') return { type: 'CAPTION', id, role, text: content, mode: 'replace' };
  return null;
}

export interface FlagCall {
  callId: string;
  category: FlagCategory;
  quote: string;
  severity: Severity;
}

const NO_QUOTE = '(no words captured)';

/**
 * The implicit `flag_concern` call. Acts only on `function_implicitly_called` (parsed arguments), never on the
 * `message_received` function_call transcript frames, so each call is handled once. Arguments may arrive as an
 * object (seen on device) or a JSON string (as in the transcript frame); both are accepted.
 */
export function parseFlagCall(msg: LiveEvent): FlagCall | null {
  if (msg.event !== 'function_implicitly_called' || !isObj(msg.data)) return null;
  const d = msg.data;
  if (d.name !== 'flag_concern') return null;
  const callId = str(d.call_id);
  if (!callId) return null;
  let args: unknown = d.arguments;
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      args = {};
    }
  }
  const a = isObj(args) ? args : {};
  const category = (FLAG_CATEGORIES as readonly string[]).includes(str(a.category) ?? '') ? (a.category as FlagCategory) : 'other';
  const severity = (SEVERITIES as readonly string[]).includes(str(a.severity) ?? '') ? (a.severity as Severity) : 'medium';
  const quote = (str(a.quote) ?? '').trim().slice(0, 1000) || NO_QUOTE;
  return { callId, category, quote, severity };
}

/** SDK errors carry `code` and sometimes `context.reason` (`no_credits_left`, `session_expired`). */
export function sdkErrorCode(err: unknown): string {
  const reason = isObj(err) && isObj(err.context) ? str(err.context.reason) : undefined;
  if (reason === 'no_credits_left') return 'NO_CREDITS';
  if (reason === 'session_expired') return 'SESSION_EXPIRED';
  return 'INTERNAL';
}
