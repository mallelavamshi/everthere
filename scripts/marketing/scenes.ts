/**
 * Marketing scenes (item 3). Each one is generated with Meta muse-image-1.0 with the device screen as a flat chroma
 * green, then compose.py puts a REAL app screenshot onto that screen in perspective. The image model never draws
 * our UI, so every screen in the final images is the real app.
 *
 * `screen` names the screenshot (scripts/marketing/screens/<screen>.png) that goes on the device.
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
  "A busy, real licensed daycare center classroom during the day: rows of labeled cubbies with little backpacks and coats, child-size tables and chairs, bright alphabet and number posters, children's paintings pinned on the walls, a carpet with a colorful map, bins of toys. In the background, slightly out of focus, several other toddlers (about 2 to 4 years old) play with blocks and draw at a low table, and another teacher in a lanyard helps them. Fluorescent and window light mixed, everyday and authentic, not a home.";

export const SCENES: readonly Scene[] = [
  {
    key: '01-daycare-tablet-girl',
    device: 'tablet',
    screen: 'tablet-call-mommy',
    size: '1792x1024',
    prompt: `${PHOTO} ${DAYCARE} In the foreground, a teary three-year-old girl sits on the classroom carpet, seen from behind over her shoulder (the back of her head and her shoulder are in the foreground). Facing her, a kind female preschool teacher in her thirties wearing a staff lanyard kneels and holds a tablet in landscape orientation at the girl's eye level, so the girl can see her mother on a video call. The tablet screen faces the girl and therefore also faces the camera, which looks over the girl's shoulder. The teacher's warm face is visible above the tablet. ${GREEN('tablet')}`,
  },
  {
    key: '02-daycare-phone-boy',
    device: 'phone',
    screen: 'phone-call-daddy',
    size: '1792x1024',
    prompt: `${PHOTO} ${DAYCARE} In the foreground, a sad two-and-a-half-year-old boy sits at a child-size table, seen from behind over his shoulder. A young male preschool teacher wearing a staff lanyard crouches beside the table facing him and holds a smartphone upright in portrait orientation at the boy's eye level, so the boy can see his father on a video call. The phone screen faces the boy and therefore also faces the camera, which looks over the boy's shoulder. ${GREEN('phone')}`,
  },
  {
    key: '01b-daycare-tablet-boy-male-teacher',
    device: 'tablet',
    screen: 'tablet-call-daddy',
    size: '1792x1024',
    prompt: `${PHOTO} ${DAYCARE} In the foreground, a teary three-year-old boy sits on the classroom carpet, seen from behind over his shoulder (the back of his head and his shoulder are in the foreground), his face turned up toward the tablet. Facing him, a kind male preschool teacher in his late twenties wearing a staff lanyard kneels and holds a tablet in landscape orientation at the boy's eye level, so the boy can see his father on a video call. The tablet screen faces the boy and therefore also faces the camera, which looks over the boy's shoulder. ${GREEN('tablet')}`,
  },
  {
    key: '02b-daycare-phone-girl-female-teacher',
    device: 'phone',
    screen: 'phone-call-mommy',
    size: '1792x1024',
    prompt: `${PHOTO} ${DAYCARE} In the foreground, a sad two-and-a-half-year-old girl with pigtails sits at a child-size table, seen from behind over her shoulder, her eyes on the phone. A warm female preschool teacher in her forties wearing a staff lanyard crouches beside the table facing her and holds a smartphone upright in portrait orientation at the girl's eye level, so the girl can see her mother on a video call. The phone screen faces the girl and therefore also faces the camera, which looks over the girl's shoulder. ${GREEN('phone')}`,
  },
  {
    key: '03-home-nanny-tablet-boy',
    device: 'tablet',
    screen: 'tablet-call-daddy',
    size: '1792x1024',
    prompt: `${PHOTO} A warm, lived-in family living room with a sofa, a knitted blanket and wooden toys on the floor. A caring nanny in her forties and an upset three-year-old boy sit side by side on the sofa, both seen from behind over their shoulders, looking together at a tablet in landscape orientation that the nanny holds in front of them, so the boy can see his father on a video call. The boy is awake and looking at the screen. The camera is directly behind them, looking over their shoulders at the tablet screen, which faces them and the camera. ${GREEN('tablet')}`,
  },
  {
    key: '04-home-nanny-phone-girl',
    device: 'phone',
    screen: 'phone-call-mommy',
    size: '1792x1024',
    prompt: `${PHOTO} A calm child's bedroom at nap time with soft afternoon light through curtains and a small bed with plush toys. A gentle nanny in her twenties sits on the edge of the bed beside a tearful two-year-old girl, holding a smartphone upright in portrait orientation so the girl can see her mother on a video call. The camera looks over the girl's shoulder, so the phone's screen faces the camera. ${GREEN('phone')}`,
  },
  {
    key: '05-mom-home-phone',
    device: 'phone',
    screen: 'phone-parent-summary',
    size: '1792x1024',
    prompt: `${PHOTO} A mother in her early thirties sits at a kitchen table at home with a cup of tea, looking at her smartphone held upright in portrait orientation with a relieved, tender smile, as if she just read good news about her child. Over-the-shoulder view from behind her, so the phone's screen faces the camera. ${GREEN('phone')}`,
  },
  {
    key: '06-dad-office-phone',
    device: 'phone',
    screen: 'phone-parent-alerts',
    size: '1792x1024',
    prompt: `${PHOTO} A father in his mid thirties at his desk in a modern, light-filled office, laptop open beside him, pauses work to read his smartphone held upright in portrait orientation in front of his chest. The camera is directly behind his right shoulder, looking over his shoulder at the phone: we see the back of his head, his shoulder and the phone screen, which faces him and the camera. A hint of his smiling cheek is visible. ${GREEN('phone')}`,
  },
  {
    key: '07-dad-home-phone',
    device: 'phone',
    screen: 'phone-parent-sessions',
    size: '1792x1024',
    prompt: `${PHOTO} A father in his thirties relaxes on a sofa at home in the evening with warm lamp light, looking at his smartphone held upright in portrait orientation with a soft smile. Over-the-shoulder view from behind him, so the phone's screen faces the camera. ${GREEN('phone')}`,
  },
  {
    key: '08-mom-office-phone',
    device: 'phone',
    screen: 'phone-parent-transcript',
    size: '1792x1024',
    prompt: `${PHOTO} A mother in her late twenties in a bright open-plan office, standing by a window with a coffee in one hand and her smartphone held upright in portrait orientation in the other, smiling gently at what she reads. Over-the-shoulder view from behind her, so the phone's screen faces the camera. ${GREEN('phone')}`,
  },
];
