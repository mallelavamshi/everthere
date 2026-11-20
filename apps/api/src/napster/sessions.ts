import type { Env } from '../env';
import { napster, NapsterError } from './client';

/** Deletes a Napster session. Resolves on success or if the session is already gone; rejects otherwise. */
export type NapsterSessionDeleter = (sessionId: string) => Promise<void>;

/**
 * Production default, built on the Napster client. The notes record no DELETE /sessions/{id} body for an
 * already-deleted id, so only "not found" shapes (404, SessionNotFound, ConnectionNotFound) count as gone, which
 * lets a child whose sessions are already deleted still be erased. Every other error rejects and aborts the cascade.
 */
export function defaultNapsterDeleteSession(env: Pick<Env, 'NAPSTER_API_KEY'>): NapsterSessionDeleter {
  const client = napster(env.NAPSTER_API_KEY);
  return async (sessionId) => {
    try {
      await client.deleteSession(sessionId);
    } catch (e) {
      if (e instanceof NapsterError && (e.status === 404 || e.code === 'SessionNotFound' || e.code === 'ConnectionNotFound')) return;
      throw e;
    }
  };
}
