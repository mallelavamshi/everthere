// Pure image helpers used by optimize.ts (exported for tests).
import sharp from 'sharp';

export type RGB = { r: number; g: number; b: number };

export async function sampleBg(file: string | Buffer): Promise<RGB> {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => {
    const i = (y * info.width + x) * info.channels;
    return [data[i]!, data[i + 1]!, data[i + 2]!];
  };
  const pts = [px(4, 4), px(info.width - 5, 4), px(4, info.height - 5), px(info.width - 5, info.height - 5)];
  const avg = (k: number) => Math.round(pts.reduce((s, p) => s + p[k]!, 0) / pts.length);
  return { r: avg(0), g: avg(1), b: avg(2) };
}

/** Bring a non-transparent image to the target aspect without stretching. */
export async function fitAspect(src: string | Buffer, aspect: number): Promise<Buffer> {
  const meta = await sharp(src).metadata();
  const w = meta.width!, h = meta.height!;
  const cur = w / h;
  if (Math.abs(cur - aspect) < 0.005) return sharp(src).toBuffer();
  if (cur > aspect) {
    const nw = Math.round(h * aspect);
    return sharp(src).extract({ left: Math.round((w - nw) / 2), top: 0, width: nw, height: h }).toBuffer();
  }
  // narrower than target: extend left/right with the sampled background
  const bg = await sampleBg(src);
  const nw = Math.round(h * aspect);
  const pad = nw - w;
  return sharp(src).extend({ left: Math.floor(pad / 2), right: Math.ceil(pad / 2), top: 0, bottom: 0, background: bg }).toBuffer();
}

export async function cleanAlpha(src: string | Buffer): Promise<Buffer> {
  // Drop the faint ghost halos left around removed outlines/sparkles.
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) if (data[i]! < 40) data[i] = 0;
  return sharp(data, { raw: info }).png().toBuffer();
}

/** Trimmed cutout centred on a transparent square, art fitted inside `box` px of `size`. */
export async function onSquare(src: string | Buffer, size: number, box: number, trim = true): Promise<Buffer> {
  let img = sharp(await cleanAlpha(src));
  if (trim) img = sharp(await img.trim({ threshold: 8 }).toBuffer());
  const art = await img.resize(box, box, { fit: 'inside' }).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: art, gravity: 'center' }])
    .png()
    .toBuffer();
}

/** Adaptive-icon foreground: art fitted inside the central 60% (Android safe zone is 66%). */
export const iconForeground = (cut: string | Buffer, size = 1024) => onSquare(cut, size, Math.round(size * 0.6));

/**
 * Place the whole image, centred and never upscaled or cropped (only shrunk if larger than the
 * canvas), on a W x H canvas filled with its sampled background; seams are feathered.
 */
export async function centerOnCanvas(src: string | Buffer, W: number, H: number, feather = 160): Promise<Buffer> {
  const bg = await sampleBg(src);
  const art = await sharp(src).resize(W, H, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  const m = await sharp(art).metadata();
  const w = m.width!, h = m.height!;
  const ramp = (len: number, horizontal: boolean, active: boolean) => {
    const f = active ? Math.min(feather, len / 2) / len : 0;
    const [x2, y2] = horizontal ? [1, 0] : [0, 1];
    const edge = active ? 0 : 1;
    return Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="${x2}" y2="${y2}">` +
        `<stop offset="0" stop-color="#fff" stop-opacity="${edge}"/><stop offset="${f}" stop-color="#fff"/>` +
        `<stop offset="${1 - f}" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="${edge}"/></linearGradient></defs>` +
        `<rect width="100%" height="100%" fill="url(#g)"/></svg>`,
    );
  };
  const feathered = await sharp(art)
    .ensureAlpha()
    .composite([
      { input: ramp(h, false, h < H), blend: 'dest-in' },
      { input: ramp(w, true, w < W), blend: 'dest-in' },
    ])
    .png()
    .toBuffer();
  return sharp({ create: { width: W, height: H, channels: 3, background: bg } })
    .composite([{ input: feathered, left: Math.round((W - w) / 2), top: Math.round((H - h) / 2) }])
    .png()
    .toBuffer();
}
