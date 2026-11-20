// jsdom has no canvas. image.ts draws through OffscreenCanvas when it exists, so tests install this small recording
// stand-in (chosen over the native `canvas` package: no binary build step on Windows/CI, and the drawing calls
// themselves are what we want to assert). A "blob" it produces is JSON describing what was encoded.
import { vi } from 'vitest';

export interface DrawCall {
  canvas: string;
  args: number[];
  filter: string;
  from: string;
}
export interface Encoded {
  w: number;
  h: number;
  type: string;
  quality: number | undefined;
}

export interface CanvasRig {
  canvases: FakeCanvas[];
  draws: DrawCall[];
  restore: () => void;
}

let seq = 0;
let rig: CanvasRig | null = null;

export class FakeCanvas {
  id = `c${seq++}`;
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    const ctx = {
      filter: 'none',
      imageSmoothingQuality: 'low',
      fillStyle: '',
      drawImage: (src: { id?: string; width?: number }, ...args: number[]) => {
        rig?.draws.push({ canvas: this.id, args, filter: ctx.filter, from: src.id ?? `${src.width}` });
      },
      fillRect: () => {},
      save: () => {},
      restore: () => {},
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    };
    return ctx;
  }
  convertToBlob(o?: { type?: string; quality?: number }) {
    const e: Encoded = { w: this.width, h: this.height, type: o?.type ?? 'image/png', quality: o?.quality };
    return Promise.resolve(new Blob([JSON.stringify(e)], { type: e.type }));
  }
}

export function installCanvas(): CanvasRig {
  const canvases: FakeCanvas[] = [];
  const Ctor = function (w: number, h: number) {
    const c = new FakeCanvas(w, h);
    canvases.push(c);
    return c;
  } as unknown as typeof OffscreenCanvas;
  vi.stubGlobal('OffscreenCanvas', Ctor);
  rig = {
    canvases,
    draws: [],
    restore: () => {
      vi.unstubAllGlobals();
      rig = null;
    },
  };
  return rig;
}

export const decode = (b: Blob): Promise<Encoded> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(JSON.parse(String(r.result)) as Encoded);
    r.onerror = () => reject(r.error);
    r.readAsText(b);
  });

/** A decoded-image stand-in with a given pixel size. */
export const fakeBitmap = (width: number, height: number) => ({ id: `src${width}x${height}`, width, height, close: () => {} }) as unknown as ImageBitmap;
