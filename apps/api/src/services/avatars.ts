import { buildAgentInstructions, isCustomVoice } from '@everthere/shared';
import type { Env } from '../env';
import type { NapsterClient, ProviderSettings } from '../napster/client';
import { MEDIA_URL_TTL_MS, signMediaUrl } from '../routes/media';

/** The slice of the Napster client the avatar flows use (injectable for tests). */
export type AvatarNapster = Pick<NapsterClient, 'createCompanion' | 'getCompanion' | 'createAgent' | 'patchAgent' | 'createConnection' | 'deleteAgent' | 'deleteCompanion'>;

export type AvatarStatus = 'creating' | 'ready' | 'approved' | 'failed';

export type AvatarRow = {
  id: string;
  user_id: string;
  napster_companion_id: string | null;
  napster_agent_id: string | null;
  voice_id: string | null;
  photo_key: string | null;
  status: AvatarStatus;
  approved_at: number | null;
  consent_name: string | null;
  consent_at: number | null;
  is_synthetic: number;
  parent_title: string;
  created_at: number;
};

export const CREATE_TIMEOUT_MS = 30 * 60_000;

/**
 * Whether a Napster companion has finished generating. Observed on the device spike (docs/notes/napster-events.md 4):
 * `pending` -> `generationCompleted` -> `readyToUse`; stock companions report `completed`. Only `readyToUse`
 * (and stock `completed`) is ready: `previewUrl` is filled while still pending, so no picture field is trusted.
 */
export function companionReadiness(companion: unknown): 'creating' | 'ready' | 'failed' {
  if (typeof companion !== 'object' || companion === null) return 'creating';
  const c = companion as Record<string, unknown>;
  const texts = (['status', 'generationStatus'] as const).map((f) => c[f]).filter((v): v is string => typeof v === 'string' && v !== '');
  // Failure wins over ready.
  if (texts.some((t) => /(fail|error)/i.test(t))) return 'failed';
  if (c.status === 'readyToUse' || c.status === 'completed') return 'ready';
  return 'creating';
}

/**
 * Every agent's provider settings (new agents here and in the seed; the same object PATCHes an existing agent).
 * Device test P-4: the phone or tablet sits on a classroom table, so room speech reached the agent and cut the avatar
 * off mid-sentence. `farField` noise reduction is Napster's setting for a mic at a distance. Turn detection is left
 * at Napster's defaults on purpose (fix round 1): young children pause mid-sentence, and a stricter threshold or a
 * shorter silence window risks cutting them off; an override would need a device test first.
 */
export const AGENT_AUDIO = {
  noiseReduction: { type: 'farField' },
} as const satisfies Pick<ProviderSettings, 'noiseReduction'>;

export const agentProviderSettings = (instructions: string): ProviderSettings => ({
  instructions,
  temperature: 0.6,
  noiseReduction: { ...AGENT_AUDIO.noiseReduction },
});

/**
 * What every agent carries besides its prompt (task 32), for new agents here and in the seed and for the agent sync:
 * - the shared FAQ collection (gentle, rule-keeping answers to what children ask) and knowledge base (calm-down
 *   stories and breathing games), when their ids are configured;
 * - no Napster idle timeout: a child resting quietly at nap time must not be cut off after 3 minutes; our own
 *   10-minute cap (LIMITS.sessionMaxMs) ends every call.
 */
export function agentResources(env: Partial<Pick<Env, 'NAPSTER_FAQ_COLLECTION_ID' | 'NAPSTER_KNOWLEDGE_BASE_ID'>>): {
  disableIdleTimeout: true;
  faqCollections?: string[];
  knowledgeBaseId?: string;
} {
  const faq = env.NAPSTER_FAQ_COLLECTION_ID?.trim();
  const kb = env.NAPSTER_KNOWLEDGE_BASE_ID?.trim();
  return { disableIdleTimeout: true, ...(faq ? { faqCollections: [faq] } : {}), ...(kb ? { knowledgeBaseId: kb } : {}) };
}

export const firstNameOf = (fullName: string): string => fullName.trim().split(/\s+/)[0] || 'Parent';

/** Warm, generic persona: no child specifics. */
export function companionDescription(firstName: string, parentTitle: string): string {
  return `A warm, gentle, caring ${parentTitle} figure named ${firstName}, who comforts young children with a soft smile and a kind, reassuring manner.`;
}

export async function pictureUrl(env: Env, photoKey: string): Promise<string> {
  return signMediaUrl(env, photoKey, MEDIA_URL_TTL_MS);
}

export async function loadAvatar(env: Pick<Env, 'DB'>, id: string): Promise<AvatarRow | null> {
  return env.DB.prepare('SELECT * FROM avatar WHERE id = ?').bind(id).first<AvatarRow>();
}

/**
 * Advances a `creating` avatar: companion ready -> create the agent once -> `ready`;
 * companion failed, or creating for over 30 minutes -> `failed`. Idempotent; also used by the cron.
 * Transient Napster errors leave the avatar `creating` (retried on the next poll).
 */
export async function advanceAvatar(env: Env, napster: AvatarNapster, avatar: AvatarRow, now = Date.now()): Promise<AvatarRow> {
  if (avatar.status !== 'creating') return avatar;

  let readiness: 'creating' | 'ready' | 'failed' = 'creating';
  if (avatar.napster_companion_id) {
    try {
      readiness = companionReadiness(await napster.getCompanion(avatar.napster_companion_id));
    } catch (e) {
      console.error('getCompanion failed', avatar.id, e);
    }
  }

  const setStatus = async (status: AvatarStatus): Promise<AvatarRow> => {
    // Guarded on the companion id so a concurrent photo change (new companion) is never overwritten.
    await env.DB
      .prepare(`UPDATE avatar SET status = ? WHERE id = ? AND status = 'creating' AND napster_companion_id IS ?`)
      .bind(status, avatar.id, avatar.napster_companion_id)
      .run();
    return (await loadAvatar(env, avatar.id)) ?? avatar;
  };

  if (readiness === 'failed') return setStatus('failed');
  if (readiness === 'creating') {
    return now - avatar.created_at > CREATE_TIMEOUT_MS ? setStatus('failed') : avatar;
  }

  // Ready: create the agent exactly once.
  if (avatar.napster_agent_id) return setStatus('ready');
  const owner = await env.DB.prepare('SELECT name FROM user WHERE id = ?').bind(avatar.user_id).first<{ name: string }>();
  const flagId = env.NAPSTER_FLAG_FUNCTION_ID;
  if (!flagId) console.warn('NAPSTER_FLAG_FUNCTION_ID is empty: creating the agent without the flag_concern tool');
  // Napster rejects agents without a voice (400 VoiceIdRequired): refuse here rather than call it.
  if (!avatar.voice_id) {
    console.error('avatar has no voice_id; not creating its agent', avatar.id);
    return now - avatar.created_at > CREATE_TIMEOUT_MS ? setStatus('failed') : avatar;
  }
  let agentId: string;
  try {
    ({ id: agentId } = await napster.createAgent({
      companionId: avatar.napster_companion_id!,
      name: `everthere-${avatar.id}-${avatar.napster_companion_id!.slice(-6)}`,
      // A digital twin's own cloned voice (`custom:<id>`) is not a stock voice: omit voiceId and the twin speaks with it.
      ...(isCustomVoice(avatar.voice_id) ? {} : { voiceId: avatar.voice_id }),
      language: 'en',
      mode: 'conversation',
      providerSettings: agentProviderSettings(buildAgentInstructions(firstNameOf(owner?.name ?? ''), avatar.parent_title)),
      functions: flagId ? [flagId] : [],
      ...agentResources(env),
    }));
  } catch (e) {
    console.error('createAgent failed', avatar.id, e);
    return now - avatar.created_at > CREATE_TIMEOUT_MS ? setStatus('failed') : avatar;
  }
  const res = await env.DB
    .prepare(
      `UPDATE avatar SET napster_agent_id = ?, status = 'ready'
       WHERE id = ? AND status = 'creating' AND napster_agent_id IS NULL AND napster_companion_id IS ? AND voice_id IS ?`,
    )
    .bind(agentId, avatar.id, avatar.napster_companion_id, avatar.voice_id)
    .run();
  if (!res.meta.changes) {
    const cur = await loadAvatar(env, avatar.id);
    if (cur && cur.status === 'creating' && cur.napster_companion_id === avatar.napster_companion_id && !cur.napster_agent_id) {
      // Only the voice changed meanwhile: adopt the agent and apply the current voice.
      const r2 = await env.DB
        .prepare(`UPDATE avatar SET napster_agent_id = ?, status = 'ready' WHERE id = ? AND status = 'creating' AND napster_agent_id IS NULL AND napster_companion_id IS ?`)
        .bind(agentId, avatar.id, avatar.napster_companion_id)
        .run();
      if (r2.meta.changes) {
        if (cur.voice_id && !isCustomVoice(cur.voice_id)) await napster.patchAgent(agentId, { voiceId: cur.voice_id }).catch((e) => console.error('voice patch failed', avatar.id, e));
        return (await loadAvatar(env, avatar.id)) ?? avatar;
      }
    }
    console.warn('avatar changed while its agent was being created; deleting the losing agent', avatar.id, agentId);
    await napster.deleteAgent(agentId).catch((e) => console.error('deleteAgent failed', agentId, e));
  }
  return (await loadAvatar(env, avatar.id)) ?? avatar;
}
