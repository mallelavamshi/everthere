/**
 * Marketing scenes (item 3). Each one is generated with Meta muse-image-1.0 with the device screen as a flat chroma
 * green, then compose.py puts a REAL app screenshot onto that screen in perspective. The image model never draws
 * our UI, so every screen in the final images is the real app.
 *
 * Families match what is on the screen (round 2, user feedback): the child looks like the parent on the call, and
 * the set covers Black, East Asian, South Asian and white families. They are the demo world's own families:
 * - Mia: Sarah (Black) and Vamshi (South Asian, the app's maker), so Mia is a mixed Black and South Asian girl.
 * - Leo: David Kim (Korean American); Ava: Hannah (white); Sam: Priya (Indian American).
 * The parent scenes show Mia's family's screens (Sarah's account), so those parents are a Black mom and a South Asian dad.
 *
 * `screen` names the capture (scripts/marketing/out/raw/<screen>.png) that compose.py puts on the device.
 */
export interface Scene {
  key: string;
  device: 'tablet' | 'phone';
  screen: string;
  size: '1792x1024' | '1024x1792' | '1024x1024';
  prompt: string;
}

const PHOTO =
  'Photorealistic candid lifestyle photograph, natural soft window light, warm and gentle mood, shot on a full-frame camera with a 35mm lens, shallow depth of field, true-to-life skin texture, no text, no logos, no watermark.';

const GREEN = (device: 'tablet' | 'phone') =>
  `The ${device} screen is switched on and shows one flat, uniform, bright chroma-key green (#00FF00) from edge to edge, with nothing else on it: no icons, no reflections, no glare. The whole screen is clearly visible to the camera and not covered by any fingers.`;

const DAYCARE =
  "A busy, real licensed daycare center classroom during the day: rows of labeled cubbies with little backpacks and coats, child-size tables and chairs, bright alphabet and number posters, children's paintings pinned on the walls, a carpet with a colorful map, bins of toys. In the background, slightly out of focus, several other toddlers of different backgrounds (about 2 to 4 years old) play with blocks and draw at a low table, and another female teacher in a lanyard helps them. All the staff are women. Fluorescent and window light mixed, everyday and authentic, not a home.";

/** The children, consistent with their parents on screen. */
const MIA = 'a four-year-old mixed-race girl, half Black and half South Asian Indian, with warm brown skin and curly dark brown hair in two puffs';
const LEO = 'a three-year-old Korean American boy with straight black hair and a fringe';
const AVA = 'a four-year-old white girl with fair skin and light brown curly hair in two braids';
const SAM = 'a four-year-old Indian American girl with warm brown skin and dark wavy hair in a short ponytail';

/** Over the child's shoulder, the device facing the child and so the camera. */
const OVER_CHILD = (device: 'tablet' | 'phone') =>
  `The ${device} screen faces the child and therefore also faces the camera, which looks over the child's shoulder; the back of the child's head and shoulder are in the foreground, the child's face turned toward the screen in three-quarter view.`;

export const SCENES: readonly Scene[] = [
  {
    key: '01-daycare-tablet-mia-mommy',
    device: 'tablet',
    screen: 'tablet-mommy-16',
    size: '1792x1024',
    prompt: `${PHOTO} ${DAYCARE} In the foreground, ${MIA}, teary-eyed, sits on the classroom carpet. Facing her, a kind Black female preschool teacher in her thirties wearing a staff lanyard kneels and holds a tablet in landscape orientation at the girl's eye level, so the girl can see her mother on a video call. ${OVER_CHILD('tablet')} ${GREEN('tablet')}`,
  },
  {
    key: '02-daycare-tablet-leo-daddy',
    device: 'tablet',
    screen: 'tablet-leo-daddy',
    size: '1792x1024',
    prompt: `${PHOTO} ${DAYCARE} In the foreground, ${LEO}, upset and quiet, sits on the classroom carpet. Facing him, a kind blonde white female preschool teacher in her late twenties wearing a staff lanyard kneels and holds a tablet in landscape orientation at the boy's eye level, so the boy can see his father on a video call. ${OVER_CHILD('tablet')} ${GREEN('tablet')}`,
  },
  {
    key: '03-daycare-phone-mia-daddy',
    device: 'phone',
    screen: 'phone-daddy-17',
    size: '1792x1024',
    prompt: `${PHOTO} ${DAYCARE} In the foreground, ${MIA}, sad, sits at a child-size table. A warm blonde white female preschool teacher in her thirties with her hair in a ponytail, wearing a staff lanyard, crouches beside the table facing her and holds a smartphone upright in portrait orientation at her eye level, so she can see her father on a video call. ${OVER_CHILD('phone')} ${GREEN('phone')}`,
  },
  {
    key: '04-daycare-phone-ava-mommy',
    device: 'phone',
    screen: 'phone-ava-mommy',
    size: '1792x1024',
    prompt: `${PHOTO} ${DAYCARE} In the foreground, ${AVA}, teary, sits at a child-size table. A gentle East Asian female preschool teacher in her forties wearing a staff lanyard crouches beside the table facing her and holds a smartphone upright in portrait orientation at her eye level, so she can see her mother on a video call. ${OVER_CHILD('phone')} ${GREEN('phone')}`,
  },
  {
    key: '05-home-nanny-tablet-leo-daddy',
    device: 'tablet',
    screen: 'tablet-leo-daddy-b',
    size: '1792x1024',
    prompt: `${PHOTO} A warm, lived-in family living room with a sofa, a knitted blanket and wooden toys on the floor. A caring Latina nanny in her forties and ${LEO}, who looks upset, sit side by side on the sofa, both seen from behind over their shoulders, looking together at a tablet in landscape orientation that the nanny holds in front of them, so the boy can see his father on a video call. The camera is directly behind them, looking over their shoulders at the tablet screen, which faces them and the camera. ${GREEN('tablet')}`,
  },
  {
    key: '06-home-nanny-phone-sam-mama',
    device: 'phone',
    screen: 'phone-sam-mama',
    size: '1792x1024',
    prompt: `${PHOTO} A calm child's bedroom at nap time with soft afternoon light through curtains and a small bed with plush toys. A gentle nanny in her twenties sits on the edge of the bed beside ${SAM}, who is tearful, holding a smartphone upright in portrait orientation so the girl can see her mother on a video call. ${OVER_CHILD('phone')} ${GREEN('phone')}`,
  },
  {
    key: '07-mom-home-phone',
    device: 'phone',
    screen: 'parent-summary-rich',
    size: '1792x1024',
    prompt: `${PHOTO} A Black mother in her early thirties with natural curly hair sits at a kitchen table at home with a cup of tea, reading her smartphone held upright in portrait orientation in front of her chest, with a relieved, tender smile. The camera is directly behind her shoulder, looking over her shoulder at the phone: we see the back of her head, her shoulder and the phone screen, which faces her and the camera. ${GREEN('phone')}`,
  },
  {
    key: '08-dad-office-phone',
    device: 'phone',
    screen: 'parent-alerts',
    size: '1792x1024',
    prompt: `${PHOTO} A South Asian Indian father in his late thirties with short black hair, at his desk in a modern, light-filled office with his laptop open, pauses work to read his smartphone held upright in portrait orientation in front of his chest, with a warm, relieved smile. The camera is directly behind his right shoulder, looking over his shoulder at the phone: we see the back of his head, his shoulder and the phone screen, which faces him and the camera. ${GREEN('phone')}`,
  },
  {
    key: '09-dad-home-phone',
    device: 'phone',
    screen: 'parent-sessions',
    size: '1792x1024',
    prompt: `${PHOTO} A South Asian Indian father in his thirties with short black hair relaxes on a sofa at home in the evening with warm lamp light, reading his smartphone held upright in portrait orientation, with a soft smile. The camera is directly behind his shoulder, looking over his shoulder at the phone: we see the back of his head, his shoulder and the phone screen, which faces him and the camera. ${GREEN('phone')}`,
  },
  {
    key: '10-mom-office-phone',
    device: 'phone',
    screen: 'parent-transcript',
    size: '1792x1024',
    prompt: `${PHOTO} A Black mother in her early thirties with natural curly hair in a bright open-plan office, standing by a window with a coffee in one hand and her smartphone held upright in portrait orientation in the other, smiling gently at what she reads. The camera is directly behind her shoulder, looking over her shoulder at the phone screen, which faces her and the camera. ${GREEN('phone')}`,
  },
  {
    key: '11-dad-commute-phone',
    device: 'phone',
    screen: 'parent-alerts',
    size: '1792x1024',
    prompt: `${PHOTO} A white father in his thirties with short light brown hair and a trimmed beard, wearing a navy jacket, sits by the window on a commuter train in the morning, reading his smartphone held upright in portrait orientation in front of his chest, with a relieved, gentle smile. The camera is directly behind his shoulder, looking over his shoulder at the phone: we see the back of his head, his shoulder and the phone screen, which faces him and the camera. Soft daylight from the train window, blurred passing city outside. ${GREEN('phone')}`,
  },
];
