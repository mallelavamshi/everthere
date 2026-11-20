import { describe, it, expect } from 'vitest';
import { ART_BIBLE } from '../../assets/artBible';
import { ADULTS, CHILDREN, CLASSROOM, ORG, PERSONAS, PLANS, ROSTER_PARENT_KEYS, SESSIONS, VAMSHI_COMPANION_ID, VAMSHI_CUSTOM_VOICE_ID, fullName } from '../personas';

describe('personas', () => {
  it('has the six story adults from the brief, then the synthetic roster parents, with *.demo@everthere.app emails', () => {
    expect(Object.values(ADULTS).map(fullName)).toEqual([
      'Sarah Johnson', 'Vamshi Krishna', 'David Kim', 'Rosa Alvarez', 'Jess Parker', 'Tanya Brooks',
      'Hannah Haddad', 'Omar Haddad', 'Amara Okafor', 'Mateo Rivera', 'Priya Patel',
    ]);
    // Roster parents are never sign-in personas, and each has an avatar.
    for (const k of ROSTER_PARENT_KEYS) {
      expect(Object.values(PERSONAS)).not.toContain(k);
      expect(ADULTS[k].avatar, k).toBeDefined();
    }
    const emails = Object.values(ADULTS).map((a) => a.email);
    for (const e of emails) expect(e).toMatch(/^[a-z]+\.[a-z]+\.demo@everthere\.app$/);
    expect(new Set(emails).size).toBe(emails.length);
  });

  it('casts the story: Sarah is Mommy, Vamshi (key marcus) and Sarah are Mia\'s parents, David is Leo\'s only parent with Rosa as nanny', () => {
    expect(ADULTS.sarah.avatar?.parentTitle).toBe('Mommy');
    expect(ADULTS.marcus.avatar?.parentTitle).toBe('Daddy');
    expect(ADULTS.david.avatar?.parentTitle).toBe('Daddy');
    for (const k of ['rosa', 'jess', 'tanya'] as const) expect(ADULTS[k].avatar).toBeUndefined();
    const mia = CHILDREN.find((c) => c.key === 'mia')!;
    const leo = CHILDREN.find((c) => c.key === 'leo')!;
    expect(mia.parents).toEqual(['sarah', 'marcus']);
    expect(leo.parents).toEqual(['david']);
    expect(leo.homeCaregiver).toBe('rosa');
    expect(PERSONAS).toEqual({ parent: 'sarah', teacher: 'jess' });
  });

  it("makes Mia's Daddy the user's own Napster companion, keeping the internal key and the existing Clerk email", () => {
    const daddy = ADULTS.marcus;
    expect(fullName(daddy)).toBe('Vamshi Krishna');
    // Task 30: his own cloned voice and a truthful likeness record.
    expect(daddy.avatar).toEqual({ parentTitle: 'Daddy', voiceId: `custom:${VAMSHI_CUSTOM_VOICE_ID}`, companionId: VAMSHI_COMPANION_ID, ownLikeness: true });
    expect(VAMSHI_CUSTOM_VOICE_ID).toBe('5edcdc24-1ebc-487c-b631-4ac6275aebf1');
    for (const a of Object.values(ADULTS)) if (a.key !== 'marcus') expect(a.avatar?.ownLikeness, a.key).toBeUndefined();
    expect(VAMSHI_COMPANION_ID).toBe('38a631dd-d5ff-4de1-bfac-89f09168eb07');
    // The email is the existing Clerk user's key (unchanged), so no new user is needed for the rename.
    expect(daddy.email).toBe('marcus.johnson.demo@everthere.app');
    // His face is the companion's, so there is no AI portrait to generate. Mommy is unchanged.
    expect(daddy.portraitPrompt).toBeUndefined();
    expect(fullName(ADULTS.sarah)).toBe('Sarah Johnson');
    expect(ADULTS.sarah.avatar).toEqual({ parentTitle: 'Mommy', voiceId: 'marin' });
    // His comfort plan with Mia stays.
    expect(PLANS.find((p) => p.child === 'mia' && p.parent === 'marcus')).toMatchObject({ tone: 'calm', nicknames: ['Mimi', 'Champ'] });
  });

  it('shows no leftover "Marcus" name in any seeded copy (roles, plans, transcripts, summaries)', () => {
    // Only text a person can read; persona keys (`marcus`) and the internal Clerk email are ids, not copy.
    const shown = [
      ...Object.values(ADULTS).flatMap((a) => [a.firstName, a.lastName, a.role]),
      ...PLANS.flatMap((p) => [...p.nicknames, ...p.favorites, ...p.phrases, p.songTitle, p.songLyrics, ...p.neverTopics, p.todayNote]),
      ...SESSIONS.flatMap((s) => [s.summary, s.caregiverNote, s.flag?.quote, ...s.lines.map((l) => l.text)]),
    ].filter((x): x is string => typeof x === 'string');
    expect(shown.filter((t) => /marcus/i.test(t))).toEqual([]);
  });

  it('places Jess in the Butterflies Room and Tanya as admin of Little Acorns Daycare (America/Chicago)', () => {
    expect(ORG).toMatchObject({ name: 'Little Acorns Daycare', timezone: 'America/Chicago', admin: 'tanya' });
    expect(CLASSROOM).toMatchObject({ name: 'Butterflies Room', teacher: 'jess' });
  });

  it('has the eight children with the mockup-5 roster statuses; ready exactly when a parent has an avatar', () => {
    expect(CHILDREN.map((c) => c.name)).toEqual(['Mia', 'Leo', 'Ava', 'Noah', 'Zoe', 'Eli', 'Isla', 'Sam']);
    expect(Object.fromEntries(CHILDREN.map((c) => [c.key, c.rosterStatus]))).toEqual({
      mia: 'ready', leo: 'ready', ava: 'ready', zoe: 'ready', eli: 'ready', sam: 'ready', noah: 'setup_pending', isla: 'invite_sent',
    });
    expect(Object.fromEntries(CHILDREN.map((c) => [c.key, c.parents.map((p) => ADULTS[p].avatar?.parentTitle)]))).toMatchObject({
      mia: ['Mommy', 'Daddy'], leo: ['Daddy'], ava: ['Mommy', 'Baba'], zoe: ['Mommy'], eli: ['Papa'], sam: ['Mama'], noah: [], isla: [],
    });
    for (const c of CHILDREN) {
      const hasAvatar = c.parents.some((p) => ADULTS[p].avatar);
      expect(c.rosterStatus === 'ready', c.key).toBe(hasAvatar);
      // Daycare-age children (2-5) with real calendar birthdays.
      const born = new Date(`${c.birthday}T00:00:00Z`);
      expect(born.toISOString().slice(0, 10)).toBe(c.birthday);
      expect(born.getUTCFullYear()).toBeGreaterThanOrEqual(2021);
    }
  });

  it('uses photoreal waist-up prompts for adults and illustrated clay prompts for children', () => {
    for (const a of Object.values(ADULTS)) {
      // Exactly the adults whose face is an existing Napster companion have no AI portrait prompt.
      expect(a.portraitPrompt === undefined, a.key).toBe(!!a.avatar?.companionId);
      if (!a.portraitPrompt) continue;
      expect(a.portraitPrompt).toMatch(/^Photorealistic waist-up portrait/);
      expect(a.portraitPrompt).toMatch(/(late 20s|early 30s|mid 30s|late 30s)/);
      expect(a.portraitPrompt).toMatch(/looking straight at the camera/i);
    }
    for (const c of CHILDREN) {
      expect(c.portraitPrompt.startsWith(ART_BIBLE)).toBe(true);
      expect(c.portraitPrompt).toMatch(/clay-toy/);
      expect(c.portraitPrompt).not.toMatch(/photoreal/i);
    }
  });

  it('has a comfort plan for every (ready child, parent avatar) pair', () => {
    const pairs = CHILDREN.filter((c) => c.rosterStatus === 'ready').flatMap((c) => c.parents.filter((p) => ADULTS[p].avatar).map((p) => `${c.key}:${p}`));
    expect(PLANS.map((p) => `${p.child}:${p.parent}`).sort()).toEqual(pairs.sort());
    for (const p of PLANS) if (p.todayNote) expect(p.todayNote.length).toBeLessThanOrEqual(120);
  });

  describe('past sessions', () => {
    it('has eight sessions of 6-12 lines, avatar first, both voices present', () => {
      expect(SESSIONS).toHaveLength(8);
      expect(new Set(SESSIONS.map((s) => s.key)).size).toBe(8);
      for (const s of SESSIONS) {
        expect(s.lines.length, s.key).toBeGreaterThanOrEqual(6);
        expect(s.lines.length, s.key).toBeLessThanOrEqual(12);
        expect(s.lines[0]!.who).toBe('avatar');
        expect(s.lines.some((l) => l.who === 'child')).toBe(true);
        expect(s.daysAgo).toBeGreaterThanOrEqual(1); // always before the seed, so never in the future
        expect(s.summary.length).toBeGreaterThan(20);
      }
    });

    it('summaries name whose avatar it was, never "you": every parent of the child sees them (device test M-1)', () => {
      for (const s of SESSIONS) {
        const title = ADULTS[s.parent].avatar!.parentTitle;
        expect(s.summary, s.key).not.toMatch(/\byou\b/i);
        expect(s.summary, s.key).toContain(`${title}'s avatar`);
        expect(s.summary.length, s.key).toBeLessThanOrEqual(300);
      }
    });

    it('only uses ready children, their own parents\' avatars, and a caregiver who can run that session', () => {
      for (const s of SESSIONS) {
        const child = CHILDREN.find((c) => c.key === s.child)!;
        expect(child.rosterStatus).toBe('ready');
        expect(child.parents).toContain(s.parent);
        expect(ADULTS[s.parent].avatar).toBeDefined();
        if (s.atDaycare) expect(s.caregiver).toBe('jess');
        else expect(s.caregiver).toBe(child.homeCaregiver);
      }
      expect(new Set(SESSIONS.map((s) => s.reason))).toEqual(new Set(['missing_parent', 'upset_nap', 'new_nervous', 'boo_boo']));
    });

    it('has exactly one flag: a boo-boo whose quote is verbatim in a child line of its transcript', () => {
      const flagged = SESSIONS.filter((s) => s.flag);
      expect(flagged).toHaveLength(1);
      const s = flagged[0]!;
      expect(s.reason).toBe('boo_boo');
      expect(s.flag!.category).toBe('injury');
      expect(s.lines.filter((l) => l.who === 'child').some((l) => l.text.includes(s.flag!.quote))).toBe(true);
      expect(s.lines.filter((l) => l.who === 'avatar').some((l) => l.text.includes(s.flag!.quote))).toBe(false);
    });

    it('keeps the avatar within its rules: no promised times or visits, no secrets', () => {
      for (const s of SESSIONS) {
        for (const l of s.lines.filter((x) => x.who === 'avatar')) {
          expect(l.text, `${s.key}: ${l.text}`).not.toMatch(/see you soon|pick you up|i('m| am) coming|on my way|secret|o'clock/i);
        }
      }
    });
  });
});
