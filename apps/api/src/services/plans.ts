import type { Tone } from '@everthere/shared';
import type { Env } from '../env';

export type PlanRow = {
  parent_title: string;
  nicknames: string;
  tone: string;
  favorites: string;
  phrases: string;
  song_title: string | null;
  song_lyrics: string | null;
  never_topics: string;
  today_note: string | null;
  today_note_expires_at: number | null;
};

export type PlanView = {
  childId: string;
  avatarId: string;
  parentTitle: string;
  tone: Tone;
  nicknames: string[];
  favorites: string[];
  phrases: string[];
  songTitle: string | null;
  songLyrics: string | null;
  neverTopics: string[];
  todayNote: string | null;
  todayNoteExpiresAt: number | null;
};

export const fetchPlan = (env: Pick<Env, 'DB'>, childId: string, avatarId: string) =>
  env.DB.prepare('SELECT * FROM comfort_plan WHERE child_id = ? AND avatar_id = ?').bind(childId, avatarId).first<PlanRow>();

/** The stored plan, or defaults when no row exists. An expired today note is dropped. */
export function planView(ids: { childId: string; avatarId: string; parentTitle: string }, p: PlanRow | null, now: number): PlanView {
  if (!p) {
    return {
      childId: ids.childId, avatarId: ids.avatarId, parentTitle: ids.parentTitle, tone: 'playful',
      nicknames: [], favorites: [], phrases: [], songTitle: null, songLyrics: null, neverTopics: [],
      todayNote: null, todayNoteExpiresAt: null,
    };
  }
  const expired = p.today_note_expires_at != null && p.today_note_expires_at <= now;
  return {
    childId: ids.childId,
    avatarId: ids.avatarId,
    parentTitle: p.parent_title,
    tone: p.tone as Tone,
    nicknames: JSON.parse(p.nicknames) as string[],
    favorites: JSON.parse(p.favorites) as string[],
    phrases: JSON.parse(p.phrases) as string[],
    songTitle: p.song_title,
    songLyrics: p.song_lyrics,
    neverTopics: JSON.parse(p.never_topics) as string[],
    todayNote: expired ? null : p.today_note,
    todayNoteExpiresAt: expired ? null : p.today_note_expires_at,
  };
}

/** Plan for (child, avatar) as stored or defaulted. */
export async function loadPlan(env: Pick<Env, 'DB'>, ids: { childId: string; avatarId: string; parentTitle: string }, now: number): Promise<PlanView> {
  return planView(ids, await fetchPlan(env, ids.childId, ids.avatarId), now);
}
