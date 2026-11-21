// App icon concepts (Meta muse-image-1.0). Full-bleed square art; the subject sits inside the centre 60% so Android's
// adaptive-icon masks (circle, squircle) never cut it. Output: marketing/out/icon/<concept>/<i>.png
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env'), quiet: true });
import fs from 'node:fs/promises';
import { metaImages } from '../../../apps/api/src/meta/client';

const BASE =
  'A premium mobile app icon, square, full-bleed artwork with no border, no rounded-corner frame, no text, no letters. ' +
  'Warm, joyful 3D clay-toy style with soft studio lighting, rounded chunky forms and a gentle glow. ' +
  'Background: a smooth radial sunset gradient, warm golden-yellow glow at the centre fading to peach and then soft lavender-purple at the edges. ' +
  'The subject is centred and fills only the middle 55 percent of the square, with calm empty gradient around it. Bold, simple, readable at small size.';

const CONCEPTS: Record<string, string> = {
  'hands-heart':
    'Subject: a glowing rounded tablet screen seen from the front; from inside the screen a big gentle grown-up clay hand reaches out, and from outside a tiny child clay hand reaches in, their fingertips touching at the glass where a small warm heart of light glows.',
  'screen-hug':
    'Subject: a chunky rounded smartphone standing upright; a pair of soft clay arms reaches out of its glowing screen and wraps a warm hug around a small golden heart in front of it.',
  'heart-window':
    'Subject: a plump glossy heart shape that is also a glowing window; inside it, a simple soft silhouette of a parent leaning down and a small child reaching up, cheek to cheek, lit warmly from within.',
  'speech-heart':
    'Subject: a plump rounded video-call bubble shaped like a heart, glowing softly, with a tiny smiling sun-yellow face inside it, and a small coral heart floating just above its top right edge.',
};

const key = process.env.META_API_KEY;
if (!key) throw new Error('META_API_KEY missing');
const api = metaImages(key);
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'out', 'icon');
await Promise.all(
  Object.entries(CONCEPTS).map(async ([name, subject]) => {
    const bufs = await api.generate({ prompt: `${BASE} ${subject}`, n: 3, size: '1024x1024', outputFormat: 'png' });
    const dir = path.join(OUT, name);
    await fs.mkdir(dir, { recursive: true });
    await Promise.all(bufs.map((b, i) => fs.writeFile(path.join(dir, `${i + 1}.png`), b)));
    console.log(name, bufs.length);
  }),
);
