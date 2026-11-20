import { afterEach, describe, expect, it, vi } from 'vitest';
import { downscaleForUpload, lightingVerdict, meanLuma, toNapsterFrame } from '../src/lib/image';
import { decode, fakeBitmap, installCanvas } from './canvasMock';

afterEach(() => vi.unstubAllGlobals());

describe('lightingVerdict', () => {
  it('maps mean luma to dark / good / bright (good is 70-210)', () => {
    expect(lightingVerdict(40)).toBe('dark');
    expect(lightingVerdict(140)).toBe('good');
    expect(lightingVerdict(230)).toBe('bright');
    expect(lightingVerdict(70)).toBe('good');
    expect(lightingVerdict(210)).toBe('good');
    expect(lightingVerdict(69.9)).toBe('dark');
    expect(lightingVerdict(210.1)).toBe('bright');
  });
});

describe('meanLuma', () => {
  const px = (r: number, g: number, b: number, n = 4) => ({ data: Uint8ClampedArray.from(Array.from({ length: n }, () => [r, g, b, 255]).flat()) });
  it('is 0 for black, 255 for white and weights green most', () => {
    expect(meanLuma(px(0, 0, 0))).toBe(0);
    expect(meanLuma(px(255, 255, 255))).toBeCloseTo(255, 5);
    expect(meanLuma(px(0, 255, 0))).toBeGreaterThan(meanLuma(px(255, 0, 0)));
  });
  it('averages mixed pixels and copes with empty data', () => {
    const d = { data: Uint8ClampedArray.from([0, 0, 0, 255, 255, 255, 255, 255]) };
    expect(meanLuma(d)).toBeCloseTo(127.5, 5);
    expect(meanLuma({ data: new Uint8ClampedArray(0) })).toBe(0);
  });
});

describe('toNapsterFrame', () => {
  it('turns a 3024x4032 portrait into a 1920x1080 JPEG at quality 0.85', async () => {
    const rig = installCanvas();
    const blob = await toNapsterFrame(fakeBitmap(3024, 4032));
    expect(await decode(blob)).toEqual({ w: 1920, h: 1080, type: 'image/jpeg', quality: 0.85 });
    expect(blob.type).toBe('image/jpeg');
    rig.restore();
  });

  it('fits the photo inside the frame, centred, over a blurred cover fill', async () => {
    const rig = installCanvas();
    await toNapsterFrame(fakeBitmap(3024, 4032));
    const frame = rig.canvases.find((c) => c.width === 1920 && c.height === 1080)!;
    const onFrame = rig.draws.filter((d) => d.canvas === frame.id);
    expect(onFrame).toHaveLength(2);
    // 1) the blurred background covers the whole frame
    expect(onFrame[0]!.filter).toBe('blur(24px)');
    expect(onFrame[0]!.args.slice(-4)).toEqual([-48, -48, 1920 + 96, 1080 + 96]); // bled past the edges
    // 2) the sharp photo is scaled to fit the height (1080) and centred: 3024*1080/4032 = 810 wide
    expect(onFrame[1]!.filter).toBe('none');
    expect(onFrame[1]!.args.slice(-4)).toEqual([(1920 - 810) / 2, 0, 810, 1080]);
    rig.restore();
  });

  it('downscales BEFORE blurring: the blur starts from a small intermediate, not the 12MP photo', async () => {
    const rig = installCanvas();
    await toNapsterFrame(fakeBitmap(3024, 4032));
    const small = rig.canvases.find((c) => c.width < 1920)!;
    expect(small).toBeDefined();
    expect(small.width * small.height).toBeLessThan(1920 * 1080);
    const toSmall = rig.draws.find((d) => d.canvas === small.id)!;
    expect(toSmall.filter).toBe('none');
    const blur = rig.draws.find((d) => d.filter === 'blur(24px)')!;
    expect(blur.from).toBe(small.id);
    expect(rig.draws.indexOf(toSmall)).toBeLessThan(rig.draws.indexOf(blur));
    rig.restore();
  });

  it('leaves no bars for a source that is already 16:9', async () => {
    const rig = installCanvas();
    await toNapsterFrame(fakeBitmap(3840, 2160));
    const frame = rig.canvases.find((c) => c.width === 1920 && c.height === 1080)!;
    const sharp = rig.draws.filter((d) => d.canvas === frame.id && d.filter === 'none');
    expect(sharp[0]!.args.slice(-4)).toEqual([0, 0, 1920, 1080]);
    rig.restore();
  });

  it('accepts an HTMLImageElement (naturalWidth/Height)', async () => {
    const rig = installCanvas();
    const img = { id: 'img', naturalWidth: 1000, naturalHeight: 1000, width: 0, height: 0 } as unknown as HTMLImageElement;
    expect(await decode(await toNapsterFrame(img))).toMatchObject({ w: 1920, h: 1080 });
    rig.restore();
  });
});

describe('downscaleForUpload', () => {
  it('shrinks the long edge to 1600 and re-encodes as JPEG', async () => {
    const rig = installCanvas();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => fakeBitmap(4000, 3000)));
    const file = new File([new Uint8Array(10)], 'a.png', { type: 'image/png' });
    const out = await downscaleForUpload(file);
    expect(createImageBitmap).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
    expect(await decode(out)).toMatchObject({ w: 1600, h: 1200, type: 'image/jpeg' });
    rig.restore();
  });

  it('honours a custom max edge and never upscales', async () => {
    const rig = installCanvas();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => fakeBitmap(800, 600)));
    const file = new File([new Uint8Array(10)], 'a.jpg', { type: 'image/jpeg' });
    expect(await downscaleForUpload(file)).toBe(file);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => fakeBitmap(800, 600)));
    expect(await decode(await downscaleForUpload(file, 400))).toMatchObject({ w: 400, h: 300 });
    rig.restore();
  });
});

describe('toNapsterFrame never enlarges', () => {
  it('draws a 1280x960 source at its own size, centred, over the blurred fill', async () => {
    const rig = installCanvas();
    await toNapsterFrame(fakeBitmap(1280, 960));
    const frame = rig.canvases.find((c) => c.width === 1920 && c.height === 1080)!;
    const sharp = rig.draws.filter((d) => d.canvas === frame.id && d.filter === 'none');
    expect(sharp[0]!.args.slice(-4)).toEqual([320, 60, 1280, 960]);
    rig.restore();
  });
});
