import { Hono } from 'hono';
import { AvatarCreateBody, AvatarPatchBody } from '@everthere/shared';
import type { AppEnv, Env } from '../env';
import { apiError, readJson } from '../http';
import { forbidDemo } from '../auth/demo';
import { newId } from '../lib/ids';
import { testClientId } from '../lib/clientIds';
import { TEST_CALL_OPENING } from '../services/sessions';
import { isOwnedKey } from '../lib/mediaKeys';
import { MEDIA_URL_TTL_MS, signMediaUrl } from './media';
import { napster as makeNapster, NapsterError } from '../napster/client';
import * as creditGuard from '../services/creditGuard';
import {
  advanceAvatar,
  companionDescription,
  firstNameOf,
  loadAvatar,
  pictureUrl,
  type AvatarNapster,
  type AvatarRow,
} from '../services/avatars';

async function view(env: Env, a: AvatarRow) {
  return {
    id: a.id,
    status: a.status,
    voiceId: a.voice_id,
    photoKey: a.photo_key,
    photoUrl: a.photo_key ? await signMediaUrl(env, a.photo_key, MEDIA_URL_TTL_MS) : null,
    parentTitle: a.parent_title,
    consentName: a.consent_name,
    consentAt: a.consent_at,
    approvedAt: a.approved_at,
    createdAt: a.created_at,
    hasAgent: a.napster_agent_id != null,
  };
}

/** Owner-only: anyone else gets NOT_FOUND so existence is not leaked. */
async function ownedAvatar(env: Env, id: string, userId: string): Promise<AvatarRow> {
  const a = await loadAvatar(env, id);
  if (!a || a.user_id !== userId) throw apiError('NOT_FOUND', 'Avatar not found');
  return a;
}

function assertPhotoKey(key: string, userId: string): void {
  if (!isOwnedKey(key, 'avatar', userId)) throw apiError('INVALID', 'photoKey is not valid for this user');
}

async function newCompanion(napster: AvatarNapster, env: Env, photoKey: string, firstName: string, parentTitle: string): Promise<string> {
  try {
    const { id } = await napster.createCompanion({
      description: companionDescription(firstName, parentTitle),
      firstName,
      pictureUrl: await pictureUrl(env, photoKey),
      version: 'v1',
    });
    return id;
  } catch (e) {
    console.error('createCompanion failed', e);
    throw apiError('INTERNAL', 'Could not create the avatar right now');
  }
}

export function avatarRoutes(opts: { napster?: AvatarNapster } = {}) {
  const r = new Hono<AppEnv>();
  const client = (env: Env): AvatarNapster => opts.napster ?? makeNapster(env.NAPSTER_API_KEY);

  // Demo accounts keep their seeded synthetic avatars: no new likeness, no photo or voice change.
  r.post('/avatars', forbidDemo, async (c) => {
    const userId = c.var.userId;
    const b = AvatarCreateBody.parse(await readJson(c));
    assertPhotoKey(b.photoKey, userId);
    const firstName = firstNameOf(c.var.me.name);
    const companionId = await newCompanion(client(c.env), c.env, b.photoKey, firstName, b.parentTitle);
    const id = newId();
    const now = Date.now();
    await c.env.DB
      .prepare(
        `INSERT INTO avatar (id, user_id, napster_companion_id, voice_id, photo_key, status, consent_name, consent_at, parent_title, created_at)
         VALUES (?, ?, ?, ?, ?, 'creating', ?, ?, ?, ?)`,
      )
      .bind(id, userId, companionId, b.voiceId, b.photoKey, b.consentName, now, b.parentTitle, now)
      .run();
    return c.json(await view(c.env, (await loadAvatar(c.env, id))!));
  });

  r.get('/avatars/mine', async (c) => {
    const { results } = await c.env.DB
      .prepare('SELECT * FROM avatar WHERE user_id = ? ORDER BY created_at DESC, id')
      .bind(c.var.userId)
      .all<AvatarRow>();
    return c.json(await Promise.all(results.map((a) => view(c.env, a))));
  });

  r.get('/avatars/:id', async (c) => {
    const a = await ownedAvatar(c.env, c.req.param('id'), c.var.userId);
    return c.json(await view(c.env, await advanceAvatar(c.env, client(c.env), a)));
  });

  r.patch('/avatars/:id', forbidDemo, async (c) => {
    const userId = c.var.userId;
    const napster = client(c.env);
    let a = await ownedAvatar(c.env, c.req.param('id'), userId);
    const b = AvatarPatchBody.parse(await readJson(c));
    if (b.photoKey !== undefined) assertPhotoKey(b.photoKey, userId);

    if (b.voiceId !== undefined) {
      if (a.napster_agent_id && (a.status === 'ready' || a.status === 'approved')) {
        try {
          await napster.patchAgent(a.napster_agent_id, { voiceId: b.voiceId });
        } catch (e) {
          console.error('patchAgent failed', e);
          throw apiError('INTERNAL', 'Could not change the voice right now');
        }
        await c.env.DB.prepare(`UPDATE avatar SET voice_id = ?, status = 'ready', approved_at = NULL WHERE id = ?`).bind(b.voiceId, a.id).run();
      } else {
        await c.env.DB.prepare('UPDATE avatar SET voice_id = ? WHERE id = ?').bind(b.voiceId, a.id).run();
      }
      a = (await loadAvatar(c.env, a.id))!;
    }

    if (b.photoKey !== undefined) {
      const oldKey = a.photo_key;
      const oldAgent = a.napster_agent_id;
      const oldCompanion = a.napster_companion_id;
      const companionId = await newCompanion(napster, c.env, b.photoKey, firstNameOf(c.var.me.name), a.parent_title);
      await c.env.DB
        .prepare(
          `UPDATE avatar SET photo_key = ?, napster_companion_id = ?, napster_agent_id = NULL, status = 'creating',
             approved_at = NULL, created_at = ?, consent_name = ?, consent_at = ? WHERE id = ?`,
        )
        .bind(b.photoKey, companionId, Date.now(), b.consentName!, Date.now(), a.id)
        .run();
      // Best-effort cleanup of the replaced agent and companion; never fails the request.
      if (oldAgent) await napster.deleteAgent(oldAgent).catch((e) => console.error('deleteAgent failed', oldAgent, e));
      if (oldCompanion) await napster.deleteCompanion(oldCompanion).catch((e) => console.error('deleteCompanion failed', oldCompanion, e));
      if (oldKey && oldKey !== b.photoKey) {
        try {
          await c.env.MEDIA.delete(oldKey);
        } catch (e) {
          console.error('R2 delete failed', oldKey, e);
        }
      }
    }
    return c.json(await view(c.env, (await loadAvatar(c.env, a.id))!));
  });

  r.post('/avatars/:id/approve', async (c) => {
    const a = await ownedAvatar(c.env, c.req.param('id'), c.var.userId);
    const res = await c.env.DB
      .prepare(`UPDATE avatar SET status = 'approved', approved_at = ? WHERE id = ? AND status = 'ready'`)
      .bind(Date.now(), a.id)
      .run();
    if (!res.meta.changes) throw apiError('INVALID', 'Only a ready avatar can be approved');
    return c.json(await view(c.env, (await loadAvatar(c.env, a.id))!));
  });

  r.post('/avatars/:id/test-session', async (c) => {
    const userId = c.var.userId;
    const a = await ownedAvatar(c.env, c.req.param('id'), userId);
    if ((a.status !== 'ready' && a.status !== 'approved') || !a.napster_agent_id) throw apiError('INVALID', 'Avatar is not ready yet');
    await creditGuard.check(c.env, userId, { kind: 'test' }); // spend cap only; test calls don't count toward 20/day
    const sessionId = newId();
    await c.env.DB
      .prepare(`INSERT INTO comfort_session (id, avatar_id, caregiver_user_id, child_id, started_at, kind) VALUES (?, ?, ?, NULL, ?, 'test')`)
      .bind(sessionId, a.id, userId, Date.now())
      .run();
    try {
      const conn = await client(c.env).createConnection(a.napster_agent_id, {
        channelType: 'webrtc',
        externalClientId: await testClientId(a.id),
        // Task 32: the agent's instructions expect an upset child; a test call is with the grown-up who made it.
        initialSpeech: TEST_CALL_OPENING,
        tags: { kind: 'test', avatarId: a.id },
      });
      await c.env.DB.prepare('UPDATE comfort_session SET napster_session_id = ? WHERE id = ?').bind(conn.connectionId, sessionId).run();
      return c.json({ sessionId, token: conn.token });
    } catch (e) {
      await c.env.DB.prepare('DELETE FROM comfort_session WHERE id = ?').bind(sessionId).run();
      if (e instanceof NapsterError && e.code === 'BUSY') throw apiError('AVATARS_BUSY', 'All avatars are busy, try again in a moment');
      console.error('test session failed', e);
      throw apiError('INTERNAL', 'Could not start the test call');
    }
  });

  return r;
}
