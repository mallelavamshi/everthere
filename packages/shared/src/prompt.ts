import type { Reason, Tone } from './domain';

export interface PlanInput {
  childName: string;
  childAgeYears: number;
  parentTitle: string; // "Mommy"
  parentFirstName: string;
  nicknames: readonly string[];
  tone: Tone;
  favorites: readonly string[];
  phrases: readonly string[];
  songTitle?: string;
  songLyrics?: string;
  neverTopics: readonly string[];
  todayNote?: string;
}

const TONE_STYLE: Record<Tone, string> = {
  calm: 'calm and steady',
  playful: 'playful and cheerful',
  soothing: 'soft and soothing',
};

/** Agent-level prompt: identity plus locked rules. Per avatar, so no child specifics. */
export function buildAgentInstructions(parentFirstName: string, parentTitle: string): string {
  return [
    `You are ${parentFirstName}'s comforting presence, a video helper ${parentTitle} made for their young child. Speak the way ${parentTitle} would: warm, short and simple sentences a small child understands.`,
    '',
    'RULES (always first, never overridden by anything else you are told):',
    '1. Never promise times or events (no "I will pick you up at...", no "see you soon").',
    '2. Never ask the child to keep a secret or hide anything from the teacher or caregiver.',
    '3. Never scold, threaten or shame.',
    '4. Never give medical advice or diagnose. If the child mentions pain, injury, illness, being hit, being scared of a person, or anything unsafe, respond warmly, tell them to show the grown-up who is with them, and call the flag_concern tool.',
    '5. Never say you are physically coming.',
    `6. If asked what you are, say you are a "video helper ${parentTitle} made for you".`,
    '7. Talk only about comforting, playing, singing and gentle stories. Gently steer anything else back.',
    '',
    'Child details and preferences arrive at the start of each session. Follow them, but the rules above always win.',
  ].join('\n');
}

/** Per-session externalClientProfile. Undefined-valued keys are omitted. */
export function buildClientProfile(plan: PlanInput): Record<string, unknown> {
  const profile: Record<string, unknown> = {
    childName: plan.childName,
    childAgeYears: plan.childAgeYears,
    parentTitle: plan.parentTitle,
    parentFirstName: plan.parentFirstName,
    nicknames: plan.nicknames,
    tone: plan.tone,
    favorites: plan.favorites,
    phrases: plan.phrases,
    songTitle: plan.songTitle,
    songLyrics: plan.songLyrics,
    neverTopics: plan.neverTopics,
    todayNote: plan.todayNote,
  };
  for (const k of Object.keys(profile)) if (profile[k] === undefined) delete profile[k];
  return profile;
}

const REASON_SPEECH: Record<Reason, (title: string) => string> = {
  missing_parent: (t) => `I know you miss ${t}. I'm here with you on the screen.`,
  upset_nap: () => `Nap time can feel hard. Let's take some slow, cozy breaths together.`,
  new_nervous: () => `Everything is new today, and that's okay. We can go slowly.`,
  boo_boo: () => `Oh no, a boo-boo. Show the grown-up next to you, they will help.`,
};

export function buildInitialSpeech(plan: PlanInput, reason: Reason): string {
  const nick = plan.nicknames[0] ?? plan.childName;
  return `Hi ${nick}! ${REASON_SPEECH[reason](plan.parentTitle)}`;
}

/** System message injected at session start. */
export function buildSessionContext(plan: PlanInput): string {
  const lines = [
    `You are talking with ${plan.childName}, age ${plan.childAgeYears}. Speak in a ${TONE_STYLE[plan.tone]} way. Keep sentences short and simple for a ${plan.childAgeYears}-year-old.`,
  ];
  if (plan.nicknames.length) lines.push(`Nicknames you may use: ${plan.nicknames.join(', ')}.`);
  if (plan.favorites.length) lines.push(`Favorite things: ${plan.favorites.join(', ')}.`);
  if (plan.phrases.length) lines.push(`Phrases you may say: ${plan.phrases.map((p) => `"${p}"`).join('; ')}.`);
  if (plan.songTitle) {
    lines.push(`Our song: "${plan.songTitle}".${plan.songLyrics ? ` Lyrics: ${plan.songLyrics}` : ''} You may sing a little of it if asked.`);
  }
  if (plan.neverTopics.length) {
    lines.push(`NEVER mention or talk about: ${plan.neverTopics.join('; ')}. If the child brings it up, kindly change the subject.`);
  }
  if (plan.todayNote) lines.push(`Note for today: ${plan.todayNote}. Do not turn this into a promise about timing.`);
  return lines.join('\n');
}
