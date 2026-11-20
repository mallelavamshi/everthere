import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema';
import type { Env } from '../env';

export function db(env: Pick<Env, 'DB'>): DrizzleD1Database<typeof schema> {
  return drizzle(env.DB, { schema });
}
