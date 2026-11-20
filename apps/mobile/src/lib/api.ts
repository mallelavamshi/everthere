import type { ApiErrorBody, ApiErrorCode } from '@everthere/shared';
import { networkStatus } from './native';
import { getActingToken } from './storage';

export const API_TIMEOUT_MS = 15_000;

export type ApiCode = ApiErrorCode | 'NETWORK';

export class ApiError extends Error {
  readonly code: ApiCode;
  readonly status: number;
  constructor(code: ApiCode, message: string, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const COPY: Record<ApiCode, string> = {
  UNAUTHENTICATED: 'Please sign in again to keep going 💛',
  FORBIDDEN: "You don't have access to that just yet.",
  NOT_FOUND: "We couldn't find that. It may have moved on.",
  INVALID: 'Something in that did not look quite right. Please check it and try again.',
  SESSION_ACTIVE: 'A comfort call is already happening for this little one.',
  AVATARS_BUSY: 'All our avatars are busy hugging. Try again in a minute 💛',
  RESTING: 'EverThere is taking a little rest. Please try again soon.',
  DEMO_READ_ONLY: 'This is a demo account, so changes are switched off. Look around as much as you like!',
  INVITE_INVALID: "That invite code didn't work. Please check it, or ask for a fresh one.",
  PIN_LOCKED: 'Too many tries. Please wait a little while and try again.',
  DEVICE_UNKNOWN: 'This tablet needs to be set up again',
  RATE_LIMITED: "You're going a bit fast. Take a breath and try again in a moment.",
  INTERNAL: 'Something got tangled on our end. Please try again.',
  NETWORK: "We can't reach EverThere right now. Check your connection and try again 💛",
};

export function friendlyMessage(code: ApiCode | string): string {
  return COPY[code as ApiCode] ?? COPY.INTERNAL;
}

type TokenGetter = (opts?: { skipCache?: boolean }) => Promise<string | null>;
let tokenGetter: TokenGetter | null = null;
/** The auth gate hands over Clerk's getToken once it is available. */
export function setTokenGetter(fn: TokenGetter | null): void {
  tokenGetter = fn;
}

const apiBase = () => (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');
const urlFor = (path: string) => `${apiBase()}${path.startsWith('/api/') ? path : `/api${path.startsWith('/') ? '' : '/'}${path}`}`;

export interface ApiInit extends Omit<RequestInit, 'body'> {
  /** Sent as a JSON body. */
  json?: unknown;
  body?: BodyInit | null;
}

const KNOWN: ReadonlySet<string> = new Set(Object.keys(COPY));
const byStatus = (s: number): ApiErrorCode =>
  s === 401 ? 'UNAUTHENTICATED' : s === 403 ? 'FORBIDDEN' : s === 404 ? 'NOT_FOUND' : s === 429 ? 'RATE_LIMITED' : s === 503 ? 'RESTING' : s >= 500 ? 'INTERNAL' : 'INVALID';

async function toError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> | null = null;
  try {
    body = (await res.json()) as Partial<ApiErrorBody>;
  } catch {
    /* not JSON */
  }
  const code = body?.error?.code;
  return new ApiError(code && KNOWN.has(code) ? code : byStatus(res.status), body?.error?.message ?? res.statusText ?? '', res.status);
}

async function once(path: string, init: ApiInit, token: string | null): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const acting = await getActingToken();
  if (acting) headers.set('X-Acting-Token', acting.token);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  const outer = init.signal;
  const onOuterAbort = () => ctrl.abort();
  outer?.addEventListener('abort', onOuterAbort);
  try {
    const { json: _json, ...rest } = init;
    return await fetch(urlFor(path), { ...rest, body, headers, signal: ctrl.signal });
  } catch (e) {
    // The caller cancelled (e.g. TanStack Query dropped the request): not a connectivity problem.
    if (outer?.aborted) throw e;
    networkStatus.reportFailure();
    throw new ApiError('NETWORK', friendlyMessage('NETWORK'));
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuterAbort);
  }
}

/** Clerk fetches tokens over the network; a failure there is a connectivity problem, not a crash. */
async function fetchToken(opts?: { skipCache?: boolean }): Promise<string | null> {
  if (!tokenGetter) return null;
  try {
    return (await (opts ? tokenGetter(opts) : tokenGetter())) ?? null;
  } catch {
    networkStatus.reportFailure();
    throw new ApiError('NETWORK', friendlyMessage('NETWORK'));
  }
}

/** Typed JSON request against the EverThere API. Throws ApiError. */
export async function api<T = unknown>(path: string, init: ApiInit = {}): Promise<T> {
  let res = await once(path, init, await fetchToken());
  if (res.status === 401 && tokenGetter) {
    // Clerk session tokens are short-lived: fetch a fresh one and retry exactly once.
    res = await once(path, init, await fetchToken({ skipCache: true }));
  }
  networkStatus.reportSuccess();
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError('INTERNAL', friendlyMessage('INTERNAL'), res.status);
  }
}
