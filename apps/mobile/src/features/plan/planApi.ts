import type { PlanView, Tone } from '@everthere/shared';
import { api } from '../../lib/api';

/** Mirrors `PlanBody` in @everthere/shared (the server validates the same bounds). */
export interface PlanInput {
  parentTitle?: string;
  tone: Tone;
  nicknames: string[];
  favorites: string[];
  phrases: string[];
  songTitle?: string;
  songLyrics?: string;
  neverTopics: string[];
  todayNote?: string;
}

export const LIMITS = { list: 12, item: 40, parentTitle: 20, songTitle: 120, lyrics: 1500, note: 120 } as const;

const path = (childId: string, avatarId: string) => `/children/${encodeURIComponent(childId)}/plans/${encodeURIComponent(avatarId)}`;

export const fetchPlan = (childId: string, avatarId: string, signal?: AbortSignal) => api<PlanView>(path(childId, avatarId), { signal });

/** PUT replaces the whole plan, so every save sends every field. */
export const putPlan = (childId: string, avatarId: string, body: PlanInput) => api<PlanView>(path(childId, avatarId), { method: 'PUT', json: body });

/** A stored plan as a PUT body. Pass `over` to change a few fields while keeping the rest. */
export function toInput(p: PlanView, over: Partial<PlanInput> = {}): PlanInput {
  return {
    tone: p.tone,
    nicknames: p.nicknames,
    favorites: p.favorites,
    phrases: p.phrases,
    songTitle: p.songTitle ?? undefined,
    songLyrics: p.songLyrics ?? undefined,
    neverTopics: p.neverTopics,
    todayNote: p.todayNote ?? undefined,
    ...over,
  };
}
