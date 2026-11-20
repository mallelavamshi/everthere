import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { centerOnCanvas, fitAspect, iconForeground, onSquare } from '../imageOps';

const solid = (w: number, h: number, c = '#FFF8EC') =>
  sharp({ create: { width: w, height: h, channels: 3, background: c } }).png().toBuffer();

/** w x h cream image with a centred ink disc of diameter d (opaque). */
async function disc(w: number, h: number, d: number) {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><circle cx="${w / 2}" cy="${h / 2}" r="${d / 2}" fill="#2B2140"/></svg>`,
  );
  return sharp(await solid(w, h)).composite([{ input: svg }]).png().toBuffer();
}
/** transparent canvas with an opaque disc at (cx, cy). */
async function cutoutDisc(size: number, d: number, cx: number, cy: number) {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${cx}" cy="${cy}" r="${d / 2}" fill="#FF7A59"/></svg>`,
  );
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: svg }])
    .png()
    .toBuffer();
}
/** bounding box of non-transparent pixels */
async function bbox(buf: Buffer) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++)
      if (data[(y * info.width + x) * 4 + 3]! > 40) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
/** bounding box of dark (ink) pixels in an opaque image */
async function inkBox(buf: Buffer) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 3;
      if (data[i]! < 100 && data[i + 1]! < 100) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
  return { w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
const dims = async (b: Buffer) => {
  const m = await sharp(b).metadata();
  return [m.width!, m.height!] as const;
};

describe('fitAspect', () => {
  it('cover-crops a wider source to the target aspect without stretching', async () => {
    const out = await fitAspect(await disc(2016, 1152, 600), 1);
    const [w, h] = await dims(out);
    expect(w / h).toBeCloseTo(1, 2);
    expect(h).toBe(1152); // cropped sideways, height untouched
    const ink = await inkBox(out);
    expect(Math.abs(ink.w - ink.h)).toBeLessThanOrEqual(2); // still round
    expect(ink.w).toBeGreaterThanOrEqual(598); // not shrunk
  });

  it('extends a narrower source with background instead of cropping', async () => {
    const out = await fitAspect(await disc(1200, 1200, 900), 1792 / 1024);
    const [w, h] = await dims(out);
    expect(w / h).toBeCloseTo(1792 / 1024, 2);
    expect(h).toBe(1200); // nothing cropped vertically
    expect(w).toBeGreaterThan(1200);
    const ink = await inkBox(out);
    expect(ink.w).toBeGreaterThanOrEqual(898); // subject intact and round
    expect(Math.abs(ink.w - ink.h)).toBeLessThanOrEqual(2);
  });

  it('returns the image unchanged when the aspect already matches', async () => {
    expect(await dims(await fitAspect(await solid(1600, 1600), 1))).toEqual([1600, 1600]);
  });
});

describe('onSquare', () => {
  it('trims, centres and keeps a circle round inside the box', async () => {
    const out = await onSquare(await cutoutDisc(800, 300, 200, 500), 1024, 900);
    expect(await dims(out)).toEqual([1024, 1024]);
    const b = await bbox(out);
    expect(Math.abs(b.w - b.h)).toBeLessThanOrEqual(2);
    expect(b.w).toBeLessThanOrEqual(900);
    expect(Math.abs((b.x0 + b.x1) / 2 - 512)).toBeLessThanOrEqual(2);
    expect(Math.abs((b.y0 + b.y1) / 2 - 512)).toBeLessThanOrEqual(2);
  });

  it('does not trim when trim=false (frames stay aligned)', async () => {
    const out = await onSquare(await cutoutDisc(800, 200, 200, 200), 1024, 900, false);
    const b = await bbox(out);
    expect(b.x1 + 1).toBeLessThan(512); // still in the upper-left quadrant
  });
});

describe('iconForeground', () => {
  it('keeps the art inside the central 66% safe zone', async () => {
    const out = await iconForeground(await cutoutDisc(1000, 900, 500, 500));
    expect(await dims(out)).toEqual([1024, 1024]);
    const b = await bbox(out);
    const lo = 1024 * 0.17, hi = 1024 * 0.83;
    expect(b.x0).toBeGreaterThanOrEqual(lo);
    expect(b.y0).toBeGreaterThanOrEqual(lo);
    expect(b.x1).toBeLessThanOrEqual(hi);
    expect(b.y1).toBeLessThanOrEqual(hi);
  });
});

describe('centerOnCanvas (portrait splash)', () => {
  it('extends to portrait without upscaling, cropping or stretching the subject', async () => {
    const out = await centerOnCanvas(await disc(2016, 1152, 500), 1024, 1792);
    expect(await dims(out)).toEqual([1024, 1792]);
    const ink = await inkBox(out);
    const scaled = 500 * (1024 / 2016); // shrunk to fit the width, never enlarged
    expect(Math.abs(ink.w - ink.h)).toBeLessThanOrEqual(2);
    expect(Math.abs(ink.w - scaled)).toBeLessThanOrEqual(3);
  });

  it('never enlarges a small source', async () => {
    const ink = await inkBox(await centerOnCanvas(await disc(400, 300, 200), 1000, 1000));
    expect(ink.w).toBeLessThanOrEqual(202);
  });
});
