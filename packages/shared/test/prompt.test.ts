import { describe, expect, test } from 'vitest';
import { buildAgentInstructions, buildClientProfile, buildInitialSpeech, buildSessionContext, type CallSituation } from '../src/prompt';

const plan = { childName:'Mia', childAgeYears:3, parentTitle:'Mommy', parentFirstName:'Sarah',
  nicknames:['Sunshine','Mia-bear'], tone:'playful', favorites:['Bunny'], phrases:['remember our bedtime song'],
  songTitle:'Twinkle Twinkle', neverTopics:["Grandpa's hospital stay"], todayNote:'Grandma picks up today' } as const;
const REASONS = ['missing_parent','upset_nap','new_nervous','boo_boo'] as const;
const daycare = (reason: CallSituation['reason']): CallSituation => ({ reason, caregiverName: 'Ms. Jess', placeName: 'Little Acorns Daycare', setting: 'daycare' });

describe('prompt builder', () => {
  test('locked rules always present', () => {
    const s = buildAgentInstructions('Sarah','Mommy');
    for (const must of ['Never promise','secret','Never scold','medical','flag_concern','video helper'])
      expect(s).toContain(must);
  });
  test('agent instructions stay a reasonable size for a realtime voice model (under 5000 characters)', () => {
    expect(buildAgentInstructions('Sarah','Mommy').length).toBeLessThan(5000);
  });
  test('locked rules forbid saying the parent is physically coming', () => {
    expect(buildAgentInstructions('Sarah','Mommy')).toContain('Never say you are physically coming');
  });
  test('client profile has no undefined values', () => {
    expect(Object.values(buildClientProfile({...plan, songLyrics: undefined})).includes(undefined)).toBe(false);
    expect(Object.values(buildClientProfile(plan, { reason: 'upset_nap', setting: 'home' })).includes(undefined)).toBe(false);
  });
});

describe('comforting method (task 32)', () => {
  const s = buildAgentInstructions('Sarah','Mommy');
  test('speaks as the parent in the first person, to a young upset child, with a caregiver holding the screen', () => {
    expect(s).toContain('You are Mommy (Sarah)');
    expect(s).toContain('first person');
    expect(s).toMatch(/teacher or nanny is holding the screen/);
    expect(s).toMatch(/upset right now/);
  });
  test('the method: connect, name the feeling, one easy question then wait, reflect, calm the body, shift, hand back', () => {
    for (const step of ['Connect.', 'Name the feeling.', 'one small, easy question', 'Then wait', 'Reflect what you heard', 'Calm the body together', 'shift attention', 'Hand back to the grown-up'])
      expect(s).toContain(step);
    expect(s).toMatch(/one to three short sentences/);
  });
  test("unclear toddler speech: never says it didn't understand, answers the feeling instead", () => {
    expect(s).toMatch(/garbled/);
    expect(s).toContain('If you could not make out the words, never say so');
    expect(s).toMatch(/The grown-up may speak for them/);
  });
  test('uses Napster memory gently and never names its documents or FAQ answers', () => {
    expect(s).toMatch(/MEMORY: you may remember earlier calls/);
    expect(s).toMatch(/Never bring up past hurts/);
    expect(s).toContain('Never mention documents, files, lists or answers you were given');
  });
  test('the rules still come last and still win', () => {
    expect(s.indexOf('RULES (always first')).toBeGreaterThan(s.indexOf('HOW TO COMFORT'));
    expect(s).toMatch(/the rules above always win\.$/);
  });
  test('works for any parent title', () => {
    expect(buildAgentInstructions('Vamshi','Daddy')).toContain('You are Daddy (Vamshi)');
  });
});

describe('opening guidance (Napster initialSpeech is guidance, not a verbatim line)', () => {
  test('every opener: as the parent, first person, nickname, ends by listening; never "right here"', () => {
    for (const reason of REASONS) {
      const o = buildInitialSpeech(plan, daycare(reason));
      expect(o).toContain('Open the call as Mommy, in the first person.');
      expect(o).toContain('Greet Sunshine');
      expect(o).toContain('then stop and listen');
      expect(o.toLowerCase()).not.toContain('right here');
    }
  });
  test('each opener asks the child one easy question that fits the reason', () => {
    expect(buildInitialSpeech(plan, daycare('missing_parent'))).toMatch(/are they missing you\?/);
    expect(buildInitialSpeech(plan, daycare('upset_nap'))).toMatch(/nap time.*slow, cozy breaths/);
    expect(buildInitialSpeech(plan, daycare('new_nervous'))).toMatch(/a little bit nervous\?/);
    expect(buildInitialSpeech(plan, daycare('boo_boo'))).toContain('show Ms. Jess where it hurts');
  });
  test('a bare reason still works (defaults to daycare, "their teacher")', () => {
    expect(buildInitialSpeech(plan, 'boo_boo')).toContain('show their teacher where it hurts');
  });
});

describe('situation in the profile and the session context', () => {
  test('profile carries why, who and where from the first word', () => {
    expect(buildClientProfile(plan, daycare('missing_parent'))).toMatchObject({
      whyThisCall: 'missing Mommy',
      whoIsHoldingTheScreen: 'Ms. Jess',
      whereTheChildIs: 'Little Acorns Daycare',
    });
    expect(buildClientProfile(plan, { reason: 'upset_nap', setting: 'home' })).toMatchObject({
      whoIsHoldingTheScreen: 'the grown-up looking after them',
      whereTheChildIs: 'at home',
    });
    expect(buildClientProfile(plan)).not.toHaveProperty('whyThisCall');
  });
  test('context opens with the situation and the plan for that reason', () => {
    const c = buildSessionContext(plan, daycare('missing_parent'));
    expect(c.split('\n')[0]).toBe('Right now: Mia is at Little Acorns Daycare with Ms. Jess, who called you because Mia is missing Mommy.');
    expect(c).toMatch(/Plan for this call: Missing Mommy is okay/);
    expect(c).toMatch(/pocket hug/);
    expect(c).toMatch(/no promise of when/);
  });
  test('each reason has its own plan', () => {
    expect(buildSessionContext(plan, daycare('upset_nap'))).toMatch(/whispery voice.*do not have to sleep/);
    expect(buildSessionContext(plan, daycare('new_nervous'))).toMatch(/brave steps/);
    const boo = buildSessionContext(plan, daycare('boo_boo'));
    expect(boo).toContain('flag_concern');
    expect(boo).toContain('Never say what the hurt is or how to treat it');
  });
  test('home calls say so', () => {
    expect(buildSessionContext(plan, { reason: 'new_nervous', caregiverName: 'Ana', setting: 'home' })).toContain('Mia is at home with Ana');
  });
  test('the plan details are kept: never-topics forbidden, today note, song', () => {
    const s = buildSessionContext(plan, daycare('upset_nap'));
    expect(s).toContain("Grandpa's hospital stay"); expect(s).toContain('Grandma picks up today');
    expect(s).toContain('Our song: "Twinkle Twinkle"');
  });
  test('without a situation (test calls) the context is the plan only', () => {
    expect(buildSessionContext(plan)).not.toContain('Right now:');
  });
});
