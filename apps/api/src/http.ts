import { HTTPException } from 'hono/http-exception';
import type { ErrorHandler, NotFoundHandler } from 'hono';
import { ZodError } from 'zod';
import type { AppEnv } from './env';

export const ERROR_STATUS = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID: 400,
  SESSION_ACTIVE: 409,
  AVATARS_BUSY: 503,
  RESTING: 503,
  DEMO_READ_ONLY: 403,
  INVITE_INVALID: 400,
  PIN_LOCKED: 429,
  /** The shared tablet's device id is not registered to this org (any more): the app must set the tablet up again. */
  DEVICE_UNKNOWN: 403,
  RATE_LIMITED: 429,
  INTERNAL: 502, // deliberate upstream (Napster) failure; unhandled errors use 500 in onError
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export type ErrorBody = { error: { code: ErrorCode; message: string } };

function jsonResponse(code: ErrorCode, message: string): Response {
  const body: ErrorBody = { error: { code, message } };
  return new Response(JSON.stringify(body), {
    status: ERROR_STATUS[code],
    headers: { 'content-type': 'application/json; charset=UTF-8' },
  });
}

export function apiError(code: ErrorCode, message: string): HTTPException {
  return new HTTPException(ERROR_STATUS[code], { res: jsonResponse(code, message), message });
}

/** Parsed JSON body, or INVALID. */
export async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw apiError('INVALID', 'Invalid JSON body');
  }
}

export const onError: ErrorHandler<AppEnv> = (err) => {
  if (err instanceof ZodError) {
    return jsonResponse('INVALID', err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  }
  if (err instanceof HTTPException) {
    if (err.res) return err.res;
    const code: ErrorCode =
      err.status === 401 ? 'UNAUTHENTICATED' : err.status === 403 ? 'FORBIDDEN' : err.status === 404 ? 'NOT_FOUND' : 'INVALID';
    return jsonResponse(code, err.message || code);
  }
  console.error(err);
  return new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'Something went wrong' } }), {
    status: 500,
    headers: { 'content-type': 'application/json; charset=UTF-8' },
  });
};

export const onNotFound: NotFoundHandler<AppEnv> = () => jsonResponse('NOT_FOUND', 'Not found');
