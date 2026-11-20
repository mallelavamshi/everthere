import type { Voice } from '@everthere/shared';

/** Friendly, human descriptors for the ten voices (the cards are a pick-a-personality, not a raw list). */
export const VOICE_INFO: Record<Voice, { label: string; descriptor: string; emoji: string }> = {
  alloy: { label: 'Alloy', descriptor: 'Warm & steady', emoji: '☕' },
  ash: { label: 'Ash', descriptor: 'Soft & low', emoji: '🌫️' },
  ballad: { label: 'Ballad', descriptor: 'Gentle storyteller', emoji: '📖' },
  coral: { label: 'Coral', descriptor: 'Bright & cheerful', emoji: '🌸' },
  echo: { label: 'Echo', descriptor: 'Calm & clear', emoji: '🔔' },
  sage: { label: 'Sage', descriptor: 'Wise & soothing', emoji: '🌿' },
  shimmer: { label: 'Shimmer', descriptor: 'Light & sunny', emoji: '✨' },
  verse: { label: 'Verse', descriptor: 'Playful & expressive', emoji: '🎭' },
  marin: { label: 'Marin', descriptor: 'Easygoing', emoji: '🌊' },
  cedar: { label: 'Cedar', descriptor: 'Deep & cozy', emoji: '🪵' },
};

export const voiceLabel = (id: string): string => VOICE_INFO[id as Voice]?.label ?? id;
export const voiceDescriptor = (id: string): string => VOICE_INFO[id as Voice]?.descriptor ?? '';

/**
 * Preview clips are optional: a play button exists only for a voice whose file is in src/assets/voices/<voice>.m4a.
 * Drop clips in that folder later and the buttons appear with no code change.
 */
const found = import.meta.glob('../../assets/voices/*.m4a', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export type VoiceClips = Partial<Record<string, string>>;

export const CLIPS: VoiceClips = Object.fromEntries(
  Object.entries(found).map(([path, url]) => [path.split(/[\\/]/).pop()!.replace(/\.m4a$/, ''), url]),
);
