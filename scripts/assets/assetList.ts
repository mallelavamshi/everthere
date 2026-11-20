import { ART_BIBLE, BG_CLEAN, BG_CREAM } from './artBible';

export type AssetGroup =
  | 'brand' | 'onboarding' | 'moments' | 'reasons' | 'empty'
  | 'stickers' | 'blobs' | 'classroom' | 'video';
export type AssetSize = '1024x1024' | '1792x1024' | '1024x1792';
export interface AssetSpec {
  key: string;
  group: AssetGroup;
  prompt: string;
  size: AssetSize;
  transparent: boolean;
  density: boolean;
}

// Small UI art that ships at 1x/2x/3x (Android densities).
const DENSITY_GROUPS: AssetGroup[] = ['reasons', 'stickers', 'classroom', 'empty'];

const a = (
  key: string,
  group: AssetGroup,
  scene: string,
  o: Partial<Pick<AssetSpec, 'size' | 'transparent' | 'density'>> = {},
): AssetSpec => {
  const transparent = o.transparent ?? false;
  return {
    key,
    group,
    prompt: `${ART_BIBLE}${scene} ${transparent ? BG_CLEAN : BG_CREAM}`,
    size: o.size ?? '1024x1024',
    transparent,
    density: o.density ?? (DENSITY_GROUPS.includes(group) || key.startsWith('moment.creating')),
  };
};
const WIDE = { size: '1792x1024' as const };
const T = { transparent: true };

// Empty states: friendly clay-toy vignettes, transparent so they sit on any card.
const empty = (key: string, scene: string) => a(key, 'empty', scene, T);

const FRAMES = [
  'a tiny clay avatar figure as a lump of soft clay just beginning to take shape, sparkles around',
  'a clay avatar figure with a rounded head and body forming, a few sparkles',
  'a clay avatar figure with face details appearing, hair being sculpted, sparkles',
  'a clay avatar figure nearly finished, a small clay hand adding a final touch',
  'a clay avatar figure complete and smiling, a soft glow around it',
  'a clay avatar figure waving hello with a burst of tiny stars',
].map((s, i) =>
  a(`moment.creating.${i + 1}`, 'moments', `Frame ${i + 1} of 6 of a gentle animation loop: ${s}. Same camera, same position in every frame.`, T),
);

const STICKERS: [string, string][] = [
  ['stars', 'ONLY three chunky sun-yellow clay stars grouped together, no characters, no animals, no people, no scene'],
  ['rainbow', 'a chunky clay rainbow arch with two small clouds at its feet'],
  ['bunny', 'a cute round clay bunny sitting, long soft ears'],
  ['dino', 'a friendly round mint-green clay baby dinosaur with little bumps on its back'],
  ['moon', 'a smiling crescent moon in lilac clay with a tiny star'],
  ['heart', 'a plump coral clay heart with a soft shine'],
  ['sun', 'a happy round sun-yellow clay sun with short rounded rays'],
  ['cloud', 'a fluffy sky-blue clay cloud with a gentle smile'],
];

const ROOMS: [string, string][] = [
  ['butterflies', 'a clay butterfly with rounded lilac and coral wings'],
  ['bees', 'a chubby clay bumblebee with tiny wings'],
  ['ladybugs', 'a round coral clay ladybug with ink dots'],
  ['owls', 'a fluffy clay owl with big friendly eyes'],
  ['turtles', 'a cute mint clay turtle with a rounded shell'],
  ['rainbows', 'a small chunky clay rainbow centered inside the badge, nothing else, no character, no animal, no person'],
  ['stars', 'a chubby sun-yellow clay star with a smile'],
  ['sunflowers', 'a clay sunflower with plump petals and a cheerful face'],
];

export const ASSETS: AssetSpec[] = [
  // Brand
  a('brand.icon', 'brand', 'App icon artwork: a single plump friendly clay heart-shaped character with two tiny arms reaching out as if for a hug, centered with generous margin, sun yellow and coral.', T),
  a('brand.iconBackground', 'brand', 'A smooth, soft, full-bleed sun-yellow gradient background with subtle clay texture and faint rounded sparkles near the edges, no subject.'),
  a('brand.splash', 'brand', 'Splash screen: the plump clay heart character centered, small clay stars floating around, lots of calm empty space.', { size: '1024x1792' }),
  a('brand.wordmark', 'brand', 'Wordmark lockup for the name "EverThere": chunky rounded clay letters spelling EverThere in ink with a small coral heart above the first e.', WIDE),
  a('brand.featureGraphic', 'brand', 'Play Store feature graphic: a young parent in their late 20s with natural dark brown hair and a clay child with natural blonde hair waving at each other across a phone-shaped window, hearts and stars between them, space on the left for a title.', WIDE),
  a('brand.cover', 'brand', 'Submission cover image: a warm scene of a young parent in their late 20s with natural black hair and medium-brown skin appearing on a tablet screen held by a smiling clay toddler with natural auburn hair in a cosy daycare room, confetti in the air.', WIDE),
  // Onboarding
  a('onboarding.hero', 'onboarding', 'Welcome hero: a clay parent figure and a clay child figure hugging warmly, both smiling with eyes closed, tiny hearts floating above, wide composition with soft pastel clouds behind.', WIDE),
  a('onboarding.parentDoor', 'onboarding', 'A cheerful round coral clay front door with a heart-shaped window, a tiny welcome mat, and a small young parent in their late 20s with natural auburn hair peeking out.', T),
  a('onboarding.daycareDoor', 'onboarding', 'A cheerful sky-blue clay daycare building front door with a rainbow arch and tiny clay toys at the doorstep.', T),
  a('onboarding.invite', 'onboarding', 'An invitation: a chunky clay envelope with a heart seal and a small key-like ticket sticking out, sparkles around.', T),
  a('onboarding.avatarPhoto', 'onboarding', 'Step illustration: a clay phone camera taking a smiling portrait, a flash of stars.', T),
  a('onboarding.avatarVoice', 'onboarding', 'Step illustration: a clay microphone with colorful sound waves and musical notes.', T),
  a('onboarding.avatarConsent', 'onboarding', 'Step illustration: a clay shield with a big heart and a friendly check mark, a small padlock.', T),
  // Moments
  ...FRAMES,
  a('moment.testCall', 'moments', 'Test-call celebration: a clay phone showing a happy face with confetti and party poppers bursting around it.', T),
  a('moment.avatarApproved', 'moments', 'Avatar approved confetti scene: a smiling young clay figure in their late 20s with natural dark brown hair and tan skin with a gold-star ribbon, bursts of colorful confetti all around.', WIDE),
  a('moment.checkIn', 'moments', 'Session check-in celebration: a clay child with natural brown hair and a young parent in their late 20s with natural blonde hair and light skin high-fiving across a phone screen, sparkles and hearts.', T),
  a('moment.feltBetter', 'moments', 'Sticker: a happy clay child figure with natural dark brown hair, tan skin and rosy cheeks and a big smile, a little sun badge above its head, thick rounded sticker outline.', T),
  // Reasons
  a('reason.missing_parent', 'reasons', 'Sticker: a small clay child with natural black hair and deep brown skin hugging a plush bunny and looking at a tiny heart floating above, wistful and gentle, thick sticker outline.', T),
  a('reason.upset_at_nap', 'reasons', 'Sticker: a sleepy clay child with natural auburn hair on a lilac pillow with a little frown and a tiny crescent moon, thick sticker outline.', T),
  a('reason.new_and_nervous', 'reasons', 'Sticker: a shy clay child with natural blonde hair peeking from behind a big sky-blue door, tiny butterflies in the air, thick sticker outline.', T),
  a('reason.boo_boo', 'reasons', 'Sticker: a clay child with natural brown hair and olive skin pointing at a small coral bandage on a knee, a brave expression, a tiny star, thick sticker outline.', T),
  // Empty states
  empty('empty.noChildren', 'A cute clay empty toy basket with a small heart, inviting and calm.'),
  empty('empty.noSessions', 'A clay phone resting on a soft cloud with a small sleepy moon beside it, waiting for the first call.'),
  empty('empty.noCaregivers', 'A pair of clay chairs side by side with a tiny teacup and a heart, empty and welcoming.'),
  empty('empty.noAlerts', 'A clay bell with a calm smile and a sparkle, wearing a tiny sleep cap, peaceful.'),
  empty('empty.noStaff', 'A clay classroom door ajar and a small empty desk with a tiny plant and an apple.'),
  empty('empty.rosterEmpty', 'A clay row of empty cubbies with tiny hooks and a single little shoe, tidy and cheerful.'),
  empty('empty.offline', 'A wobbly clay wifi symbol on a floating cloud, looking sleepy-confused, with a few little swirls.'),
  empty('empty.avatarsBusy', 'Several clay avatar figures in a cosy queue chatting happily, a tiny hourglass above, relaxed.'),
  empty('empty.resting', 'A clay sun-yellow heart character fast asleep on a lilac pillow with floating zzz stars.'),
  empty('empty.error', 'A clay character holding a tiny wrench next to a slightly wobbly coral cube, apologetic but cheerful.'),
  // Decorative
  ...STICKERS.map(([k, s]) => a(`sticker.${k}`, 'stickers', `Sticker: ${s}, thick rounded sticker outline.`, T)),
  a('blob.parent', 'blobs', 'A soft, huge, abstract rounded blob shape background in warm sun yellow with faint clay texture and gentle highlights. No subject, no text.', WIDE),
  a('blob.admin', 'blobs', 'A soft, huge, abstract rounded blob shape background in sky blue with faint clay texture and gentle highlights. No subject, no text.', WIDE),
  a('blob.caregiver', 'blobs', 'A soft, huge, abstract rounded blob shape background in mint green with faint clay texture and gentle highlights. No subject, no text.', WIDE),
  // Classroom emblems
  ...ROOMS.map(([k, s]) => a(`classroom.${k}`, 'classroom', `Room emblem: ${s}, in a round badge medallion, thick rounded outline.`, T)),
  // Video
  a('video.title', 'video', 'Demo video title card: the plump clay heart character and a young parent in their late 20s with natural brown hair and a clay child with natural black hair, big empty banner space in the middle.', WIDE),
  a('video.end', 'video', 'Demo video end card: the plump clay heart character waving goodbye amid confetti, empty space at the bottom for credits.', WIDE),
  a('video.chapterParent', 'video', 'Chapter card: a young parent in their late 20s with natural black hair and deep brown skin holding a phone, sun-yellow theme, empty space for a title.', WIDE),
  a('video.chapterDaycare', 'video', 'Chapter card: a clay daycare room with children with natural hair colors and a young teacher in their late 20s with natural auburn hair, sky-blue theme, empty space for a title.', WIDE),
  a('video.chapterCall', 'video', 'Chapter card: a clay child with natural blonde hair on a video call with a young parent in their late 20s with natural brown hair, mint theme, empty space for a title.', WIDE),
];
