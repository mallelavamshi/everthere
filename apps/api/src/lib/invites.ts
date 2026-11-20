import { LIMITS, generateCode } from '@everthere/shared';
import type { Env } from '../env';
import { apiError } from '../http';
import { newId } from './ids';

type E = Pick<Env, 'DB'>;

// The generator lives in @everthere/shared so scripts/seed makes demo codes the same way.
export { CODE_ALPHABET, CODE_LENGTH, generateCode } from '@everthere/shared';
export type InviteType = 'staff' | 'parent_enrollment' | 'co_parent' | 'home_caregiver';


export const normalizeCode = (raw: string): string => raw.trim().toUpperCase();

export async function createInvite(
  env: E,
  args: { type: InviteType; payload: Record<string, unknown>; createdBy: string },
): Promise<{ code: string; expiresAt: number }> {
  const expiresAt = Date.now() + LIMITS.inviteTtlMs;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const r = await env.DB
      .prepare(
        `INSERT OR IGNORE INTO invite_code (code, type, payload, created_by, expires_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(code, args.type, JSON.stringify(args.payload), args.createdBy, expiresAt)
      .run();
    if (r.meta.changes === 1) return { code, expiresAt };
  }
  throw new Error('could not allocate invite code');
}

export type InviteRow = {
  code: string;
  type: InviteType;
  payload: string;
  created_by: string;
  expires_at: number;
  used_at: number | null;
};

/** Live (unused, unexpired) invite or INVITE_INVALID. */
export async function loadLiveInvite(env: E, rawCode: string): Promise<InviteRow & { data: Record<string, any> }> {
  const row = await env.DB
    .prepare(`SELECT code, type, payload, created_by, expires_at, used_at FROM invite_code WHERE code = ?`)
    .bind(normalizeCode(rawCode))
    .first<InviteRow>();
  if (!row || row.used_at != null || row.expires_at <= Date.now()) throw apiError('INVITE_INVALID', 'Invite code is not valid');
  let data: Record<string, any> = {};
  try {
    data = JSON.parse(row.payload);
  } catch {
    throw apiError('INVITE_INVALID', 'Invite code is not valid');
  }
  return { ...row, data };
}

export async function peekInvite(env: E, rawCode: string) {
  const inv = await loadLiveInvite(env, rawCode);
  const inviter = await env.DB.prepare('SELECT name FROM user WHERE id = ?').bind(inv.created_by).first<{ name: string }>();
  const out: { type: InviteType; orgName?: string; childName?: string; inviterName: string } = {
    type: inv.type,
    inviterName: inviter?.name ?? '',
  };
  if (typeof inv.data.orgId === 'string') {
    const o = await env.DB.prepare('SELECT name FROM org WHERE id = ?').bind(inv.data.orgId).first<{ name: string }>();
    if (o) out.orgName = o.name;
  }
  if (inv.type === 'parent_enrollment' && typeof inv.data.enrollmentId === 'string') {
    const en = await env.DB
      .prepare('SELECT child_name FROM enrollment WHERE id = ?')
      .bind(inv.data.enrollmentId)
      .first<{ child_name: string }>();
    if (en) out.childName = en.child_name;
  }
  return out;
}

export { newId };
