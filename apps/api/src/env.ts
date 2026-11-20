import type { UserRow } from './db/schema';

export interface Env {
  // bindings
  DB: D1Database;
  MEDIA: R2Bucket;
  AI: Ai;
  // vars
  PUBLIC_API_BASE: string;
  NAPSTER_FLAG_FUNCTION_ID: string;
  DEV_ROUTES?: string;
  SPIKE_AGENT_ID?: string; // dev only: agent for POST /api/dev/napster-token (DEV_ROUTES=1)
  CLERK_AUTHORIZED_PARTIES?: string; // optional comma-separated azp allowlist
  // secrets
  NAPSTER_API_KEY: string;
  NAPSTER_WEBHOOK_SECRET: string;
  CLERK_SECRET_KEY: string;
  META_API_KEY: string;
  MEDIA_SIGNING_KEY: string;
  ADMIN_TOKEN: string;
  ACTING_TOKEN_KEY: string;
}

/** actingUserId/actingOrgId are set together, only for a fully valid X-Acting-Token (see auth/acting.ts). */
export type AppVariables = { userId: string; actingUserId?: string; actingOrgId?: string; me: UserRow };
export type AppEnv = { Bindings: Env; Variables: AppVariables };
