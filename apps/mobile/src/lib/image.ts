// Image helpers for the avatar flow: the Napster picture frame, the live lighting check and child-photo downscaling.

export type Source = ImageBitmap | HTMLImageElement;
export type Lighting = 'dark' | 'good' | 'bright';

export const FRAME_W = 1920;
export const FRAME_H = 1080;
const JPEG_QUALITY = 0.85;
const BLUR_PX = 24;
/** The blur starts from a picture this many times smaller than the frame (cheap), then is stretched up. */
const BLUR_DOWNSCALE = 8;
/** The blurred layer is drawn this far past every edge so blurring never fades to transparent at the border. */
const BLEED = 48;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const UPLOAD_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp']);

type Canvas = OffscreenCanvas | HTMLCanvasElement;
type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

const sizeOf = (s: Source) => ({
  w: 'naturalWidth' in s && s.naturalWidth ? s.naturalWidth : s.width,
  h: 'naturalHeight' in s && s.naturalHeight ? s.naturalHeight : s.height,
});

function makeCanvas(w: number, h: number): Canvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function ctxOf(c: Canvas): Ctx {
  const ctx = c.getContext('2d') as Ctx | null;
  if (!ctx) throw new Error('Canvas is not available');
  return ctx;
}

function encode(c: Canvas, type: string, quality: number): Promise<Blob> {
  if ('convertToBlob' in c) return c.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image'))), type, quality));
}

/**
 * A 1920x1080 JPEG (quality 0.85) for Napster's pictureUrl. The photo is scaled DOWN to fit inside the frame (never enlarged) and centred;
 * where it does not fill the frame (a portrait always leaves side bars) the bars are the same photo scaled to cover
 * the frame and blurred by 24px. The photo is downscaled BEFORE blurring so the expensive filter never touches a
 * 12-megapixel bitmap.
 */
export async function toNapsterFrame(src: Source): Promise<Blob> {
  const { w: sw, h: sh } = sizeOf(src);
  const frame = makeCanvas(FRAME_W, FRAME_H);
  const ctx = ctxOf(frame);
  // Never enlarge: a small photo stays sharp and the blurred fill covers the rest.
  const fit = Math.min(1, FRAME_W / sw, FRAME_H / sh);
  const dw = Math.round(sw * fit);
  const dh = Math.round(sh * fit);
  const bars = dw < FRAME_W || dh < FRAME_H;

  if (bars) {
    const smallW = Math.round(FRAME_W / BLUR_DOWNSCALE);
    const smallH = Math.round(FRAME_H / BLUR_DOWNSCALE);
    const small = makeCanvas(smallW, smallH);
    const sctx = ctxOf(small);
    const cover = Math.max(smallW / sw, smallH / sh);
    const cw = sw * cover;
    const ch = sh * cover;
    sctx.drawImage(src, (smallW - cw) / 2, (smallH - ch) / 2, cw, ch);
    ctx.filter = `blur(${BLUR_PX}px)`;
    ctx.drawImage(small as CanvasImageSource, -BLEED, -BLEED, FRAME_W + BLEED * 2, FRAME_H + BLEED * 2);
    ctx.filter = 'none';
  }

  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, Math.round((FRAME_W - dw) / 2), Math.round((FRAME_H - dh) / 2), dw, dh);
  return encode(frame, 'image/jpeg', JPEG_QUALITY);
}

/** Mean brightness (0-255, Rec. 601 weights) of RGBA pixels. 0 for no pixels. */
export function meanLuma(img: { data: ArrayLike<number> }): number {
  const d = img.data;
  const n = Math.floor(d.length / 4);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n * 4; i += 4) sum += 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
  return sum / n;
}

/** `good` is 70-210; anything darker or brighter gets a nudge in the camera chip. */
export function lightingVerdict(luma: number): Lighting {
  return luma < 70 ? 'dark' : luma > 210 ? 'bright' : 'good';
}

/** Decodes a file honouring its EXIF orientation (so a phone portrait is not sideways). */
export async function loadBitmap(file: Blob): Promise<Source> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file, { imageOrientation: 'from-image' });
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Child photos: long edge at most `maxEdge`, JPEG. A small, supported file is returned untouched. */
export async function downscaleForUpload(file: File | Blob, maxEdge = 1600): Promise<Blob> {
  const bmp = await loadBitmap(file);
  try {
    const { w, h } = sizeOf(bmp);
    if (Math.max(w, h) <= maxEdge && UPLOAD_TYPES.has(file.type) && file.size <= MAX_UPLOAD_BYTES) return file;
    const scale = Math.min(1, maxEdge / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    const c = makeCanvas(tw, th);
    const ctx = ctxOf(c);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, tw, th);
    return await encode(c, 'image/jpeg', JPEG_QUALITY);
  } finally {
    if ('close' in bmp) bmp.close();
  }
}
