import { describe, expect, test } from 'vitest';
import { buildAgentInstructions, buildClientProfile, buildInitialSpeech, buildSessionContext } from '../src/prompt';

const plan = { childName:'Mia', childAgeYears:3, parentTitle:'Mommy', parentFirstName:'Sarah',
  nicknames:['Sunshine','Mia-bear'], tone:'playful', favorites:['Bunny'], phrases:['remember our bedtime song'],
  songTitle:'Twinkle Twinkle', neverTopics:["Grandpa's hospital stay"], todayNote:'Grandma picks up today' } as const;

describe('prompt builder', () => {
  test('locked rules always present', () => {
    const s = buildAgentInstructions('Sarah','Mommy');
    for (const must of ['Never promise','secret','Never scold','medical','flag_concern','video helper'])
      expect(s).toContain(must);
  });
  test('agent instructions stay under 2500 characters', () => {
    expect(buildAgentInstructions('Sarah','Mommy').length).toBeLessThan(2500);
  });
  test('initial speech uses a nickname and fits the reason', () => {
    const s = buildInitialSpeech(plan,'upset_nap');
    expect(s).toMatch(/Sunshine|Mia-bear/); expect(s.toLowerCase()).toContain('nap');
  });
  test('session context lists never-topics as forbidden and includes today note', () => {
    const s = buildSessionContext(plan);
    expect(s).toContain("Grandpa's hospital stay"); expect(s).toContain('Grandma picks up today');
  });
  test('locked rules forbid saying the parent is physically coming', () => {
    expect(buildAgentInstructions('Sarah','Mommy')).toContain('Never say you are physically coming');
  });
  test('no opening line implies physical presence ("right here")', () => {
    for (const reason of ['missing_parent','upset_nap','new_nervous','boo_boo'] as const) {
      expect(buildInitialSpeech(plan, reason).toLowerCase()).not.toContain('right here');
    }
    expect(buildInitialSpeech(plan,'missing_parent')).toContain("I'm here with you on the screen");
  });
  test('client profile has no undefined values', () => {
    expect(Object.values(buildClientProfile({...plan, songLyrics: undefined})).includes(undefined)).toBe(false);
  });
});
