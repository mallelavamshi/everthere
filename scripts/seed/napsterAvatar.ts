// The seed's per-parent Napster and photo steps, split out of seed.ts so they can be tested with a fake client.
// No env, no file I/O: seed.ts passes in the Napster client, the signed picture URL and a state saver.
import sharp from 'sharp';
import type { NapsterClient } from '../../apps/api/src/napster/client';
import { agentProviderSettings, companionDescription, companionReadiness, firstNameOf } from '../../apps/api/src/services/avatars';
import { buildAgentInstructions } from '../../packages/shared/src/prompt';
import { avatarId } from './fixture';
import { fullName, type Adult } from './personas';

export type NapsterRec = { companionId?: string; agentId?: string };
export type SeedNapster = Pick<NapsterClient, 'createCompanion' | 'getCompanion' | 'createAgent'>;

/** Napster rejects pictures of 5 MB or more ("Image is too large"); keep headroom. */
export const NAPSTER_MAX_BYTES = 4_500_000;

/**
 * What the Napster step will do for one adult, from its state record alone (no network):
 * - `none`: not a parent with an avatar.
 * - `keep`: the companion and agent in state are already the right ones.
 * - `agent`: the companion exists (in state, or the persona names an existing one); only the agent is created.
 * - `companion+agent`: a new companion from the seeded portrait, then its agent.
 * A persona with `avatar.companionId` never gets a companion created: a state record pointing at a different
 * companion is replaced (the old companion and agent are left in Napster untouched, just no longer referenced).
 */
export function napsterPlan(a: Adult, rec: NapsterRec | undefined): 'none' | 'keep' | 'agent' | 'companion+agent' {
  if (!a.avatar) return 'none';
  const preset = a.avatar.companionId;
  if (preset) return rec?.companionId === preset && rec.agentId ? 'keep' : 'agent';
  if (rec?.agentId) return 'keep';
  return rec?.companionId ? 'agent' : 'companion+agent';
}

export type EnsureDeps = {
  napster: SeedNapster;
  /** Signed URL of the seeded portrait; only called when a companion has to be created. */
  pictureUrl: () => Promise<string>;
  flagFunctionId: string;
  /** Persists state after each Napster write (so a crash never orphans a created resource). */
  save: (rec: NapsterRec) => void;
  log?: (msg: string) => void;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  maxWaitMs?: number;
};

/**
 * Makes sure `a` has a ready companion and an agent on it, creating only what is missing (see napsterPlan).
 * Returns the record to keep in state; `replaced` is the earlier record when a preset companion superseded it.
 */
export async function ensureNapsterAvatar(
  a: Adult,
  current: NapsterRec | undefined,
  d: EnsureDeps,
): Promise<{ rec: NapsterRec; replaced?: NapsterRec }> {
  const log = d.log ?? (() => {});
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  if (!a.avatar) return { rec: current ?? {} };
  const title = a.avatar.parentTitle;
  const preset = a.avatar.companionId;
  let replaced: NapsterRec | undefined;
  let rec: NapsterRec = { ...(current ?? {}) };
  if (preset && rec.companionId !== preset) {
    if (rec.companionId || rec.agentId) replaced = { ...rec };
    rec = { companionId: preset };
  }
  if (rec.agentId) return { rec, replaced };

  if (!rec.companionId) {
    const pictureUrl = await d.pictureUrl();
    rec.companionId = (await d.napster.createCompanion({ description: companionDescription(a.firstName, title), firstName: a.firstName, pictureUrl, version: 'v1' })).id;
    d.save({ ...rec });
    log(`napster: companion for ${a.key} -> ${rec.companionId}`);
  }
  const started = Date.now();
  for (;;) {
    const readiness = companionReadiness(await d.napster.getCompanion(rec.companionId));
    if (readiness === 'ready') break;
    if (readiness === 'failed') throw new Error(`napster: companion ${rec.companionId} for ${a.key} failed; delete it from state.json to retry`);
    if (Date.now() - started > (d.maxWaitMs ?? 30 * 60_000)) throw new Error(`napster: companion ${rec.companionId} for ${a.key} still not ready after 30 min`);
    log(`napster: waiting for ${a.key}'s companion...`);
    await sleep(d.pollMs ?? 15_000);
  }
  rec.agentId = (
    await d.napster.createAgent({
      companionId: rec.companionId,
      name: `everthere-${avatarId(a.key)}-${rec.companionId.slice(-6)}`,
      voiceId: a.avatar.voiceId,
      language: 'en',
      mode: 'conversation',
      providerSettings: agentProviderSettings(buildAgentInstructions(firstNameOf(fullName(a)), title)),
      functions: d.flagFunctionId ? [d.flagFunctionId] : [],
    })
  ).id;
  d.save({ ...rec });
  log(`napster: agent for ${a.key} -> ${rec.agentId}`);
  return { rec, replaced };
}

/** Whether a persona's app photo must be (re)made from its preset companion's preview image. */
export const needsCompanionPhoto = (a: Adult, photoFrom: string | undefined): boolean =>
  !!a.avatar?.companionId && photoFrom !== a.avatar.companionId;

/** The companion's preview image URL (Napster's `previewUrl`), or an error naming what is missing. */
export function previewUrlOf(companion: Record<string, unknown>): string {
  const u = companion.previewUrl;
  if (typeof u !== 'string' || !/^https:\/\//.test(u)) throw new Error(`companion ${String(companion.id)} has no https previewUrl`);
  return u;
}

/** Any image -> PNG (the avatar key format is .png), downscaled step by step until it is under NAPSTER_MAX_BYTES. */
export async function toAvatarPng(img: Buffer, maxBytes = NAPSTER_MAX_BYTES): Promise<Buffer> {
  let out = await sharp(img).rotate().png({ compressionLevel: 9 }).toBuffer();
  let w = (await sharp(out).metadata()).width ?? 0;
  while (out.length > maxBytes && w > 640) {
    w = Math.round(w * 0.9);
    out = await sharp(img).rotate().resize({ width: w }).png({ compressionLevel: 9 }).toBuffer();
  }
  return out;
}

/** Clerk first/last name update for an existing user whose name differs from the persona, or null. */
export function clerkNamePatch(a: Adult, user: { first_name?: string | null; last_name?: string | null }): { first_name: string; last_name: string } | null {
  return user.first_name === a.firstName && user.last_name === a.lastName ? null : { first_name: a.firstName, last_name: a.lastName };
}
