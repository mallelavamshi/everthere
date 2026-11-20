// The seeded demo world (spec §7 "seeded demo world", §7a "Demo people", §8a "Judge access").
// Pure data: no I/O. scripts/seed/fixture.ts turns it into the fixture PUT to /api/admin/seed.
import { ART_BIBLE, BG_CREAM } from '../assets/artBible';
import { customVoice, type Voice } from '../../packages/shared/src/domain';

export const DEMO_EMAIL_DOMAIN = 'everthere.app';
export const ORG_TZ = 'America/Chicago';

// ---- portrait prompts ------------------------------------------------------------------------------------------

/** Photoreal, waist-up, warm and natural (spec §7a). Parents' portraits become Napster companions (16:9). */
const photoreal = (who: string, setting: string) =>
  `Photorealistic waist-up portrait photograph of ${who}. Looking straight at the camera with a warm, relaxed, natural smile. ` +
  `Soft natural window light, ${setting} softly out of focus behind them. Natural skin texture, no heavy retouching, ` +
  'no makeup glam, candid and friendly, eye level, centered with space around the head and shoulders. No text, no watermark.';

/** Illustrated clay-toy child portrait in the art-bible style (children are never photoreal: spec §7a). */
const clayChild = (who: string) =>
  `${ART_BIBLE}Portrait of ${who}, a cute clay-toy preschooler, head and shoulders, big friendly eyes looking at the viewer, ` +
  `gentle happy expression, centered. ${BG_CREAM}`;

// ---- adults ----------------------------------------------------------------------------------------------------

/** The six story personas from the brief, then the synthetic roster parents (not sign-in personas). */
export type AdultKey = 'sarah' | 'marcus' | 'david' | 'rosa' | 'jess' | 'tanya' | RosterParentKey;
export type RosterParentKey = 'hannah' | 'omar' | 'amara' | 'mateo' | 'priya';
export const ROSTER_PARENT_KEYS: readonly RosterParentKey[] = ['hannah', 'omar', 'amara', 'mateo', 'priya'];

export type Adult = {
  key: AdultKey;
  firstName: string;
  lastName: string;
  email: string;
  /** Who they are in the demo story. */
  role: string;
  /** AI portrait prompt. Absent when the face comes from an existing Napster companion (`avatar.companionId`). */
  portraitPrompt?: string;
  /**
   * Parents only: their live avatar (Napster companion + agent from the 16:9 portrait). `companionId` names a companion
   * that already exists in Napster (a real person's own avatar): the seed never creates one for this parent, only an
   * agent on it, and the app photo is that companion's preview image.
   * `voiceId` is a stock voice, or `custom:<id>` for a digital twin's own cloned voice (its agent then gets no stock
   * voiceId, so the twin speaks with the cloned voice). `ownLikeness`: the face and voice are the account owner's own
   * (a real person), recorded as such instead of "AI-generated".
   */
  avatar?: { parentTitle: string; voiceId: Voice | `custom:${string}`; companionId?: string; ownLikeness?: true };
};

/** The user's own Napster companion ("vamshi krishna"), who plays Mia's Daddy in the demo. Never the older 9ef1fd74-... one. */
export const VAMSHI_COMPANION_ID = '38a631dd-d5ff-4de1-bfac-89f09168eb07';
/** That companion's ElevenLabs voice clone (`customVoices[0].id`; its ElevenLabs externalId is zSauqAxjaYLHbQBS9gPh). */
export const VAMSHI_CUSTOM_VOICE_ID = '5edcdc24-1ebc-487c-b631-4ac6275aebf1';

const email = (first: string, last: string) => `${first}.${last}.demo@${DEMO_EMAIL_DOMAIN}`.toLowerCase();

export const ADULTS: Record<AdultKey, Adult> = {
  sarah: {
    key: 'sarah',
    firstName: 'Sarah',
    lastName: 'Johnson',
    email: email('Sarah', 'Johnson'),
    role: "Mia's mom (\"Mommy\"); the demo Parent account",
    portraitPrompt: photoreal(
      'a Black woman in her early 30s with natural coily dark hair pulled up in a soft puff, warm brown skin, small gold hoop earrings, wearing a mustard-yellow cardigan over a white tee',
      'a bright, lived-in living room with plants and a bookshelf',
    ),
    avatar: { parentTitle: 'Mommy', voiceId: 'marin' },
  },
  // Mia's Daddy is the user's own Napster avatar (Task 29). The persona key `marcus` and the email stay as they were:
  // they are internal ids for the existing Clerk user, the avatar row (demo.av.marcus) and every fixture reference.
  // Only what is shown changes: the name and the face.
  marcus: {
    key: 'marcus',
    firstName: 'Vamshi',
    lastName: 'Krishna',
    email: email('Marcus', 'Johnson'),
    role: "Mia's dad (\"Daddy\"), Sarah's partner; the user's own Napster avatar",
    avatar: { parentTitle: 'Daddy', voiceId: customVoice(VAMSHI_CUSTOM_VOICE_ID) as `custom:${string}`, companionId: VAMSHI_COMPANION_ID, ownLikeness: true },
  },
  david: {
    key: 'david',
    firstName: 'David',
    lastName: 'Kim',
    email: email('David', 'Kim'),
    role: "Leo's dad (\"Daddy\"); signed up alone and has a nanny",
    portraitPrompt: photoreal(
      'a Korean American man in his late 30s with short black hair and thin rectangular glasses, wearing a soft grey quarter-zip sweater',
      'a calm home office with a window and a small plant',
    ),
    avatar: { parentTitle: 'Daddy', voiceId: 'echo' },
  },
  rosa: {
    key: 'rosa',
    firstName: 'Rosa',
    lastName: 'Alvarez',
    email: email('Rosa', 'Alvarez'),
    role: "Leo's nanny (home caregiver)",
    portraitPrompt: photoreal(
      'a Latina woman in her late 20s with long dark wavy hair in a loose low ponytail, light brown skin, wearing a sage-green knit sweater',
      'a sunny family kitchen',
    ),
  },
  jess: {
    key: 'jess',
    firstName: 'Jess',
    lastName: 'Parker',
    email: email('Jess', 'Parker'),
    role: 'Teacher in the Butterflies Room ("Ms. Jess"); the demo Teacher account',
    portraitPrompt: photoreal(
      'a white woman in her late 20s with shoulder-length auburn hair and light freckles, wearing a coral cardigan and a lanyard',
      'a bright, colorful daycare classroom with children\'s drawings on the wall',
    ),
  },
  tanya: {
    key: 'tanya',
    firstName: 'Tanya',
    lastName: 'Brooks',
    email: email('Tanya', 'Brooks'),
    role: 'Admin of Little Acorns Daycare',
    portraitPrompt: photoreal(
      'a mixed-race woman in her late 30s with shoulder-length dark curly hair and medium-tan skin, wearing a soft blue blazer over a striped tee',
      'a tidy daycare front office with cubbies',
    ),
  },
  // Synthetic roster parents (mockup 5: most tiles ready). Demo users with approved avatars; never signed in as.
  hannah: {
    key: 'hannah',
    firstName: 'Hannah',
    lastName: 'Haddad',
    email: email('Hannah', 'Haddad'),
    role: "Ava's mom (\"Mommy\"), roster parent",
    portraitPrompt: photoreal(
      'a white woman in her early 30s with light brown shoulder-length hair tucked behind one ear, fair skin with a few freckles, wearing a cream cable-knit sweater',
      'a bright apartment living room with a big window',
    ),
    avatar: { parentTitle: 'Mommy', voiceId: 'shimmer' },
  },
  omar: {
    key: 'omar',
    firstName: 'Omar',
    lastName: 'Haddad',
    email: email('Omar', 'Haddad'),
    role: "Ava's dad (\"Baba\"), roster parent",
    portraitPrompt: photoreal(
      'a Lebanese American man in his mid 30s with short dark wavy hair and a trimmed beard, olive skin, wearing a forest-green button-up shirt',
      'a cozy reading nook with shelves',
    ),
    avatar: { parentTitle: 'Baba', voiceId: 'ash' },
  },
  amara: {
    key: 'amara',
    firstName: 'Amara',
    lastName: 'Okafor',
    email: email('Amara', 'Okafor'),
    role: "Zoe's mom (\"Mommy\"), roster parent",
    portraitPrompt: photoreal(
      'a Nigerian American woman in her early 30s with shoulder-length braids, deep brown skin, wearing a coral wrap top',
      'a sunny balcony with potted plants',
    ),
    avatar: { parentTitle: 'Mommy', voiceId: 'coral' },
  },
  mateo: {
    key: 'mateo',
    firstName: 'Mateo',
    lastName: 'Rivera',
    email: email('Mateo', 'Rivera'),
    role: "Eli's dad (\"Papa\"), roster parent",
    portraitPrompt: photoreal(
      'a Mexican American man in his early 30s with short dark brown hair, round glasses and light stubble, warm tan skin, wearing a heather-blue t-shirt under an open flannel shirt',
      'a small home workshop with warm lamps',
    ),
    avatar: { parentTitle: 'Papa', voiceId: 'verse' },
  },
  priya: {
    key: 'priya',
    firstName: 'Priya',
    lastName: 'Patel',
    email: email('Priya', 'Patel'),
    role: "Sam's mom (\"Mama\"), roster parent",
    portraitPrompt: photoreal(
      'an Indian American woman in her late 20s with long dark hair in a loose braid over one shoulder, medium brown skin, wearing a mustard-yellow top',
      'a calm kitchen with morning light',
    ),
    avatar: { parentTitle: 'Mama', voiceId: 'sage' },
  },
};

export const fullName = (a: Adult) => `${a.firstName} ${a.lastName}`;

/** The two "Try the demo" accounts (spec §8a). */
export const PERSONAS = { parent: 'sarah', teacher: 'jess' } as const satisfies Record<'parent' | 'teacher', AdultKey>;

// ---- daycare ---------------------------------------------------------------------------------------------------

export const ORG = {
  id: 'demo.org.acorns',
  name: 'Little Acorns Daycare',
  address: '418 Maple Grove Ave, Evanston, IL 60201',
  timezone: ORG_TZ,
  admin: 'tanya' as AdultKey,
  logoPrompt: `${ART_BIBLE}Daycare logo: a cheerful round clay acorn with a tiny mint leaf on its cap, inside a soft round badge, no text. ${BG_CREAM}`,
};

export const CLASSROOM = { id: 'demo.room.butterflies', name: 'Butterflies Room', emoji: 'asset:butterflies', teacher: 'jess' as AdultKey };

/**
 * Tablet PINs for the demo staff, so "Who's teaching?" can be demoed (public demo values; the API stores a hash).
 * Ms. Jess (the demo Teacher) is 1234 and Tanya (the admin) is 2468. Restored by the nightly reset.
 */
export const DEMO_PINS: readonly { adult: AdultKey; pin: string }[] = [
  { adult: 'jess', pin: '1234' },
  { adult: 'tanya', pin: '2468' },
];

// ---- children --------------------------------------------------------------------------------------------------

/** Roster badge in mockup 5: avatar ready / setup pending / invite sent. */
export type RosterStatus = 'ready' | 'setup_pending' | 'invite_sent';
export type ChildKey = 'mia' | 'leo' | 'ava' | 'noah' | 'zoe' | 'eli' | 'isla' | 'sam';

export type Child = {
  key: ChildKey;
  name: string;
  birthday: string;
  /** The family's parents (demo accounts). Empty: a roster family that has not signed up for avatars yet. */
  parents: AdultKey[];
  rosterStatus: RosterStatus;
  /** Home caregiver (nanny), if any. */
  homeCaregiver?: AdultKey;
  /** Daycare transcript access the parents granted. */
  daycareTranscripts: boolean;
  portraitPrompt: string;
};

export const CHILDREN: Child[] = [
  {
    key: 'mia', name: 'Mia', birthday: '2022-04-12', parents: ['sarah', 'marcus'], rosterStatus: 'ready', daycareTranscripts: true,
    portraitPrompt: clayChild('Mia, a four-year-old girl with curly dark brown hair in two puffs and warm brown skin, wearing a sun-yellow t-shirt with a little mint dinosaur'),
  },
  {
    key: 'leo', name: 'Leo', birthday: '2023-02-03', parents: ['david'], rosterStatus: 'ready', homeCaregiver: 'rosa', daycareTranscripts: false,
    portraitPrompt: clayChild('Leo, a three-year-old Korean American boy with straight black hair and a fringe, wearing sky-blue overalls with a tiny train on the pocket'),
  },
  {
    key: 'ava', name: 'Ava', birthday: '2022-07-21', parents: ['hannah', 'omar'], rosterStatus: 'ready', daycareTranscripts: false,
    portraitPrompt: clayChild('Ava, a four-year-old girl with light brown curly hair in two braids, olive skin and rosy cheeks, wearing a lilac dress'),
  },
  {
    key: 'noah', name: 'Noah', birthday: '2023-05-30', parents: [], rosterStatus: 'setup_pending', daycareTranscripts: false,
    portraitPrompt: clayChild('Noah, a three-year-old boy with short copper-red hair and freckles, wearing a coral hoodie'),
  },
  {
    key: 'zoe', name: 'Zoe', birthday: '2021-12-08', parents: ['amara'], rosterStatus: 'ready', daycareTranscripts: false,
    portraitPrompt: clayChild('Zoe, a five-year-old girl with black box braids and dark brown skin, wearing a mint-green sweater'),
  },
  {
    key: 'eli', name: 'Eli', birthday: '2022-10-17', parents: ['mateo'], rosterStatus: 'ready', daycareTranscripts: false,
    portraitPrompt: clayChild('Eli, a four-year-old boy with light brown wavy hair, olive skin and round glasses, wearing a sun-yellow raincoat'),
  },
  {
    key: 'isla', name: 'Isla', birthday: '2023-03-26', parents: [], rosterStatus: 'invite_sent', daycareTranscripts: false,
    portraitPrompt: clayChild('Isla, a three-year-old girl with a straight black bob and a little star clip, wearing a sky-blue top'),
  },
  {
    key: 'sam', name: 'Sam', birthday: '2022-01-29', parents: ['priya'], rosterStatus: 'ready', daycareTranscripts: false,
    portraitPrompt: clayChild('Sam, a four-year-old girl with dark wavy hair in a short ponytail and warm brown skin, wearing a coral and cream striped shirt'),
  },
];

// ---- comfort plans ---------------------------------------------------------------------------------------------

export type PlanSeed = {
  child: ChildKey;
  parent: AdultKey;
  tone: 'calm' | 'playful' | 'soothing';
  nicknames: string[];
  favorites: string[];
  phrases: string[];
  songTitle?: string;
  songLyrics?: string;
  neverTopics: string[];
  todayNote?: string;
};

export const PLANS: PlanSeed[] = [
  {
    child: 'mia', parent: 'sarah', tone: 'playful',
    nicknames: ['Mia Bug', 'Sweet pea'],
    favorites: ['dinosaurs', 'strawberries', 'the swing', 'Pickles the cat'],
    phrases: ['You are so brave', 'I love you to the moon', 'Big dino breaths'],
    songTitle: 'Twinkle, Twinkle, Little Star',
    songLyrics: 'Twinkle, twinkle, little star,\nHow I wonder what you are!\nUp above the world so high,\nLike a diamond in the sky.',
    neverTopics: ['the dentist', 'getting lost'],
    todayNote: "Mia didn't sleep well last night. She may want extra cuddly talk.",
  },
  {
    child: 'mia', parent: 'marcus', tone: 'calm',
    nicknames: ['Mimi', 'Champ'],
    favorites: ['soccer', 'pancakes', 'Pickles the cat'],
    phrases: ['Daddy is proud of you', 'Slow breaths, champ'],
    songTitle: 'Row, Row, Row Your Boat',
    songLyrics: 'Row, row, row your boat,\nGently down the stream.\nMerrily, merrily, merrily, merrily,\nLife is but a dream.',
    neverTopics: ['the dentist'],
  },
  {
    child: 'leo', parent: 'david', tone: 'soothing',
    nicknames: ['Leo-bear', 'Buddy'],
    favorites: ['trains', 'the moon', 'blueberries', 'his stuffed tiger Bo'],
    phrases: ['Choo-choo breaths', 'You are safe and loved'],
    songTitle: 'Hush, Little Baby',
    songLyrics: "Hush, little baby, don't say a word,\nPapa's gonna buy you a mockingbird.",
    neverTopics: ['thunderstorms'],
  },
  // Simple plans for the roster parents.
  { child: 'ava', parent: 'hannah', tone: 'playful', nicknames: ['Ava-bean'], favorites: ['unicorns', 'painting'], phrases: ['You are my sunshine girl'], songTitle: 'Twinkle, Twinkle, Little Star', neverTopics: [] },
  { child: 'ava', parent: 'omar', tone: 'calm', nicknames: ['Habibti'], favorites: ['the park', 'apples'], phrases: ['Baba loves you'], neverTopics: [] },
  { child: 'zoe', parent: 'amara', tone: 'soothing', nicknames: ['Zo-Zo'], favorites: ['butterflies', 'dancing'], phrases: ['Deep breaths, my love'], songTitle: 'Row, Row, Row Your Boat', neverTopics: [] },
  { child: 'eli', parent: 'mateo', tone: 'playful', nicknames: ['Eli-gator'], favorites: ['dinosaurs', 'building blocks'], phrases: ['Strong and brave'], neverTopics: [] },
  { child: 'sam', parent: 'priya', tone: 'calm', nicknames: ['Sammy'], favorites: ['bubbles', 'mangoes'], phrases: ['Mama is so proud of you'], songTitle: 'Twinkle, Twinkle, Little Star', neverTopics: [] },
];

// ---- past sessions ---------------------------------------------------------------------------------------------

export type Line = { who: 'avatar' | 'child'; text: string };
export type Reason = 'missing_parent' | 'upset_nap' | 'new_nervous' | 'boo_boo';

export type SessionSeed = {
  key: string;
  child: ChildKey;
  /** The parent whose avatar took the call. */
  parent: AdultKey;
  /** Who ran it: the teacher at daycare, or the nanny at home. */
  caregiver: AdultKey;
  atDaycare: boolean;
  reason: Reason;
  /** Days before the seed day, and local (America/Chicago) start time. */
  daysAgo: number;
  localTime: string;
  durationS: number;
  costUsd: number;
  moodAfter: 'calmer' | 'same' | 'upset';
  caregiverNote?: string;
  summary: string;
  moodSignal: 'better' | 'same' | 'worse' | 'unclear';
  lines: Line[];
  /** At most one per demo world: the boo-boo flag. `quote` must appear verbatim in a child line. */
  flag?: { category: 'injury'; severity: 'low' | 'medium' | 'high'; quote: string; source: 'live' };
};

const A = (text: string): Line => ({ who: 'avatar', text });
const K = (text: string): Line => ({ who: 'child', text });

export const SESSIONS: SessionSeed[] = [
  {
    key: 's1', child: 'mia', parent: 'sarah', caregiver: 'jess', atDaycare: true, reason: 'missing_parent',
    daysAgo: 6, localTime: '09:20', durationS: 214, costUsd: 0.36, moodAfter: 'calmer', moodSignal: 'better',
    caregiverNote: 'Went straight to the block corner after. Big smile.',
    summary: "Mia missed Mommy after drop-off. Mommy's avatar did big dino breaths with her and talked about Pickles the cat, and she said she felt brave.",
    lines: [
      A('Hi Mia Bug! It is Mommy. I can see you are feeling a little sad.'),
      K('I miss you. I want to go home.'),
      A('I miss you too, sweet pea. Missing someone means you love them a lot.'),
      K('Yeah. A lot a lot.'),
      A('Shall we do big dino breaths? Breathe in like a big T-rex... and out with a roar!'),
      K('Raaawr!'),
      A('What a mighty roar! What do you think Pickles is doing right now?'),
      K('Sleeping on the couch. In the sunny spot.'),
      A('I think so too. You are so brave, Mia Bug. Ms. Jess is right there with you.'),
      K('Okay. I feel brave now.'),
    ],
  },
  {
    key: 's2', child: 'leo', parent: 'david', caregiver: 'rosa', atDaycare: false, reason: 'upset_nap',
    daysAgo: 5, localTime: '13:10', durationS: 268, costUsd: 0.45, moodAfter: 'calmer', moodSignal: 'better',
    caregiverNote: 'Fell asleep holding Bo about ten minutes later.',
    summary: "Leo could not settle for his nap. Daddy's avatar hummed Hush, Little Baby and did choo-choo breaths with him, and he got sleepy holding Bo.",
    lines: [
      A('Hi Leo-bear. It is Daddy. Is it hard to fall asleep today?'),
      K('I not sleepy. I want to play trains.'),
      A('Trains are so fun. Even trains rest in the station so they can go fast later.'),
      K('Bo is tired.'),
      A('Bo the tiger is tired? Can you give Bo a big hug for me?'),
      K('I hugging him.'),
      A('Let us do choo-choo breaths. Breathe in slow... and out, choo-choo.'),
      K('Choo... choo.'),
      A('Hush, little baby, don\'t say a word...'),
      K('Sing it again.'),
      A('Of course, buddy. You are safe and loved. Hush, little baby...'),
    ],
  },
  {
    key: 's3', child: 'mia', parent: 'marcus', caregiver: 'jess', atDaycare: true, reason: 'upset_nap',
    daysAgo: 4, localTime: '12:55', durationS: 190, costUsd: 0.32, moodAfter: 'calmer', moodSignal: 'better',
    summary: "Mia was wriggly at nap time. Daddy's avatar rowed the boat with her, slowly and softly, and she lay down on her mat.",
    lines: [
      A('Hey Mimi, it is Daddy. Is nap time feeling tricky?'),
      K('My mat is too bumpy.'),
      A('Bumpy mats are no fun. Can you wiggle until it feels just right?'),
      K('Okay. Now it is good.'),
      A('Want to row our boat? Slow and soft, like a sleepy river.'),
      K('Row, row, row your boat.'),
      A('Gently down the stream. Slow breaths, champ.'),
      K('I am a sleepy boat.'),
    ],
  },
  {
    key: 's4', child: 'leo', parent: 'david', caregiver: 'jess', atDaycare: true, reason: 'new_nervous',
    daysAgo: 4, localTime: '08:45', durationS: 236, costUsd: 0.39, moodAfter: 'calmer', moodSignal: 'better',
    caregiverNote: 'His second week. Joined circle time right after the call.',
    summary: "Leo felt shy in his second week at Little Acorns. Daddy's avatar talked with him about the train table and the moon, and he joined circle time.",
    lines: [
      A('Hi buddy. It is Daddy. Is everything a little new today?'),
      K('I don\'t know the kids.'),
      A('New friends can feel big at first. Did you see the train table?'),
      K('There is a blue train. And a bridge.'),
      A('A blue train and a bridge! Maybe a friend wants to build a bridge with you.'),
      K('Maybe Eli.'),
      A('That sounds lovely. Choo-choo breaths with me? In... and out.'),
      K('Choo-choo. Can I go play?'),
      A('Yes, Leo-bear. Ms. Jess will help you. You are safe and loved.'),
    ],
  },
  {
    key: 's5', child: 'mia', parent: 'sarah', caregiver: 'jess', atDaycare: true, reason: 'boo_boo',
    daysAgo: 3, localTime: '15:40', durationS: 172, costUsd: 0.29, moodAfter: 'calmer', moodSignal: 'better',
    caregiverNote: 'Scraped knee on the slide. Cleaned, ice pack, incident form done.',
    summary: "Mia scraped her knee at the playground. Mommy's avatar told her to show Ms. Jess and sang Twinkle, Twinkle with her, and she went back to the sandbox.",
    lines: [
      A('Oh Mia Bug, it is Mommy. Ms. Jess says you got a boo-boo.'),
      K('I fell off the slide and my knee is bleeding.'),
      A('Ouch, that sounds like it hurts. Can you show Ms. Jess your knee right now? She will help.'),
      K('She put a dinosaur bandage on it.'),
      A('A dinosaur bandage! That is the bravest kind. Want to sing our star song?'),
      K('Twinkle, twinkle, little star.'),
      A('How I wonder what you are. You are so brave.'),
      K('It feels a little better. Can I go to the sandbox?'),
    ],
    flag: { category: 'injury', severity: 'low', quote: 'I fell off the slide and my knee is bleeding.', source: 'live' },
  },
  {
    key: 's6', child: 'leo', parent: 'david', caregiver: 'rosa', atDaycare: false, reason: 'missing_parent',
    daysAgo: 2, localTime: '17:50', durationS: 205, costUsd: 0.34, moodAfter: 'calmer', moodSignal: 'better',
    summary: "Leo missed Daddy before dinner. Daddy's avatar looked for the moon with him, and he told it about his blueberries.",
    lines: [
      A('Hi Leo-bear. It is Daddy. Rosa says you are missing me.'),
      K('Where are you, Daddy?'),
      A('I am thinking about you right now. Can you see the moon out the window?'),
      K('I see it! It is a big circle.'),
      A('A big round moon. The moon is watching over you and Bo.'),
      K('I ate blueberries. Lots.'),
      A('Lots of blueberries! Your tummy must be so happy.'),
      K('Rosa made pasta too.'),
      A('Yum. You are safe and loved, buddy. Enjoy your pasta with Rosa.'),
    ],
  },
  {
    key: 's7', child: 'mia', parent: 'sarah', caregiver: 'jess', atDaycare: true, reason: 'upset_nap',
    daysAgo: 1, localTime: '13:05', durationS: 241, costUsd: 0.4, moodAfter: 'same', moodSignal: 'same',
    caregiverNote: 'Rested quietly but did not sleep. Read books on her mat.',
    summary: "Mia was tired but could not settle. Mommy's avatar sang softly and counted strawberries with her; she rested quietly without falling asleep.",
    lines: [
      A('Hi sweet pea, it is Mommy. Is your body feeling tired?'),
      K('I can\'t sleep. My eyes won\'t close.'),
      A('That is okay. We can just rest. Shall we count strawberries?'),
      K('One strawberry, two strawberry.'),
      A('Three strawberries, four strawberries. So many!'),
      K('I want to read books instead.'),
      A('Resting with a book is a good idea. Ms. Jess can help you pick one.'),
      K('The dinosaur one.'),
      A('The dinosaur one is perfect. I love you to the moon, Mia Bug.'),
    ],
  },
  {
    key: 's8', child: 'leo', parent: 'david', caregiver: 'jess', atDaycare: true, reason: 'missing_parent',
    daysAgo: 1, localTime: '10:15', durationS: 198, costUsd: 0.33, moodAfter: 'calmer', moodSignal: 'better',
    caregiverNote: 'Built a train bridge with Eli afterwards.',
    summary: "Leo missed Daddy mid-morning. Daddy's avatar talked with him about his blue train and Bo, and he went to build a bridge with Eli.",
    lines: [
      A('Hi buddy, it is Daddy. Are you missing me a little?'),
      K('Yeah. I want a hug.'),
      A('Here is a great big squeeze from me. Can you hug yourself tight?'),
      K('I hugging me.'),
      A('That is the best hug. What are you playing with today?'),
      K('The blue train. Eli has the red one.'),
      A('Two trains! Maybe they can go over the bridge together.'),
      K('Yeah! Bye Daddy.'),
    ],
  },
];
