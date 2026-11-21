// The hosted web build on a wide screen (a judge's laptop): the real app runs inside a phone, beside a short guide.
// The app is loaded in a phone-sized iframe, so it sees a 390 x 844 viewport and lays out exactly as it does on a
// phone (CSS media queries and the app's own width checks all read the iframe, not the laptop window). The Android
// app is never framed, nor is a phone browser. ?frame=0 opens the full-width app (the classroom-tablet layout).
import { useEffect, useState } from 'react';
import { gradients } from '../theme/tokens';

export const PHONE_W = 390;
export const PHONE_H = 844;
const BEZEL = 12;
const MIN_WIDTH = 700;

export function shouldFrame(o: { native: boolean; isTop: boolean; width: number; search: string }): boolean {
  if (o.native || !o.isTop || o.width < MIN_WIDTH) return false;
  return new URLSearchParams(o.search).get('frame') !== '0';
}

/** Shrinks the phone (never grows it) so it fits the window's height with a margin. */
export function phoneScale(windowHeight: number): number {
  return Math.min(1, (windowHeight - 64) / (PHONE_H + BEZEL * 2));
}

const APK = 'https://github.com/mallelavamshi/everthere-app/releases/latest';
const SOURCE = 'https://github.com/mallelavamshi/everthere';

export function PhoneFrame() {
  const [scale, setScale] = useState(() => phoneScale(window.innerHeight));
  useEffect(() => {
    const onResize = () => setScale(phoneScale(window.innerHeight));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const src = window.location.pathname + window.location.search + window.location.hash;
  const outerW = PHONE_W + BEZEL * 2;
  const outerH = PHONE_H + BEZEL * 2;

  return (
    <div className="flex min-h-screen items-center justify-center gap-16 px-8 font-sans text-ink" style={{ background: gradients.sunGradient }}>
      <aside className="hidden max-w-[400px] min-[1000px]:block">
        <div className="flex items-center gap-3">
          <img src="/everthere-icon.svg" alt="" className="h-14 w-14 rounded-[16px] shadow-chunky" />
          <span className="text-4xl font-bold">EverThere</span>
        </div>
        <p className="mt-5 text-2xl font-semibold">Be there, even when you can’t.</p>
        <p className="mt-3 text-lg text-mutedText">
          A parent’s live AI avatar comforts their child at daycare or at home. This is the real app, running live.
        </p>
        <ol className="mt-7 space-y-3 text-lg">
          <li>
            <b>1.</b> Tap <b>Try the demo</b>, then <b>Peek as a Teacher</b>.
          </li>
          <li>
            <b>2.</b> Tap <b>Mia</b>, pick <b>Missing Daddy</b>, and call. Allow the microphone.
          </li>
          <li>
            <b>3.</b> Say <b>“I fell and hurt my knee”</b> and watch the flag.
          </li>
          <li>
            <b>4.</b> Sign out, <b>Peek as a Parent</b>, and read the summary.
          </li>
        </ol>
        <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-base font-semibold">
          <a className="underline decoration-2 underline-offset-4" href={APK} target="_blank" rel="noreferrer">
            Android APK
          </a>
          <a className="underline decoration-2 underline-offset-4" href={SOURCE} target="_blank" rel="noreferrer">
            Source code
          </a>
          <a className="underline decoration-2 underline-offset-4" href="/?frame=0">
            Classroom tablet view
          </a>
        </div>
        <p className="mt-6 text-sm text-mutedText">Live avatars by Napster on Microsoft Azure</p>
      </aside>

      <div style={{ width: outerW * scale, height: outerH * scale }} className="shrink-0">
        <div
          className="rounded-[56px] bg-ink shadow-[0_30px_80px_rgba(43,33,64,0.35)]"
          style={{ width: outerW, height: outerH, padding: BEZEL, transform: `scale(${scale})`, transformOrigin: 'top left' }}
        >
          <iframe
            title="EverThere app"
            src={src}
            allow="microphone; camera; autoplay; clipboard-write"
            className="block rounded-[44px] border-0 bg-cream"
            style={{ width: `${PHONE_W}px`, height: `${PHONE_H}px` }}
          />
        </div>
      </div>
    </div>
  );
}
