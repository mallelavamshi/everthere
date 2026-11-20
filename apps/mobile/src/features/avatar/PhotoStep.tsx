import { useEffect, useState } from 'react';
import clsx from 'clsx';
import type { Lighting } from '../../lib/image';
import { haptics } from '../../lib/native';
import { pickPhoto } from '../../lib/pickPhoto';
import { Button, Illustration, toast } from '../../ui';
import { Step } from '../onboarding/Step';
import { useCamera } from './useCamera';

const CHIP: Record<Lighting, { text: string; cls: string }> = {
  good: { text: '☀️ Great light', cls: 'bg-sun' },
  dark: { text: '🌙 A bit dark, find some light', cls: 'bg-coral' },
  bright: { text: '😎 Too bright, turn from the window', cls: 'bg-coral' },
};

export interface PhotoStepProps {
  /** The chosen photo, after the parent taps "Use this". */
  onPhoto: (photo: Blob) => void;
  onBack?: () => void;
  childName?: string;
  steps?: { total: number; current: number } | null;
}

/** Mockup 2: a live front camera with a head-and-shoulders guide and a lighting chip, then Use this / Retake. */
export function PhotoStep({ onPhoto, onBack, childName, steps = { total: 3, current: 1 } }: PhotoStepProps) {
  const [shot, setShot] = useState<Blob | null>(null);
  const [shotUrl, setShotUrl] = useState<string | null>(null);
  // Where the photo came from: a gallery photo is not 'retaken', the secondary button picks another one.
  const [fromGallery, setFromGallery] = useState(false);
  const { videoRef, status, lighting, facing, capture, flip } = useCamera(shot === null);

  // The preview URL lives exactly as long as the photo it shows.
  useEffect(() => {
    if (!shot) {
      setShotUrl(null);
      return;
    }
    const url = URL.createObjectURL(shot);
    setShotUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [shot]);

  const snap = async () => {
    haptics.light();
    const b = await capture();
    if (b) {
      setFromGallery(false);
      setShot(b);
    }
    else toast.error('The camera is still waking up. Try again in a second 💛');
  };
  const pick = async (kind: 'camera' | 'gallery') => {
    const b = await pickPhoto(kind);
    if (b) {
      setFromGallery(kind === 'gallery');
      setShot(b);
    }
  };

  const gallery = (
    <button
      type="button"
      aria-label="Choose from your photos"
      onClick={() => void pick('gallery')}
      className="grid h-14 w-14 place-items-center rounded-full border-2 border-ink bg-white text-[24px] active:bg-sun/40"
    >
      <span aria-hidden="true">🖼️</span>
    </button>
  );

  // ---- preview -------------------------------------------------------------------------------------------------
  if (shot) {
    return (
      <Step
        steps={steps ?? undefined}
        back={onBack}
        title="Looking great! 💛"
        sub={`Is this the one ${childName ?? 'your little one'} will see?`}
        footer={
          <div className="flex flex-col gap-3">
            <Button size="lg" fullWidth haptic onClick={() => onPhoto(shot)}>
              Use this
            </Button>
            {fromGallery ? (
              <Button variant="white" fullWidth onClick={() => void pick('gallery')}>
                Choose another
              </Button>
            ) : (
              <Button variant="white" fullWidth onClick={() => setShot(null)}>
                Retake
              </Button>
            )}
          </div>
        }
      >
        <div className="aspect-[3/4] w-full overflow-hidden rounded-[24px] border-[3px] border-ink bg-ink shadow-chunky">
          {shotUrl ? <img src={shotUrl} alt="Your photo" className="h-full w-full object-cover" /> : null}
        </div>
      </Step>
    );
  }

  // ---- camera / fallback ---------------------------------------------------------------------------------------
  const unavailable = status === 'unavailable';
  return (
    <Step
      steps={steps ?? undefined}
      back={onBack}
      title="Let's make your avatar"
      sub={`${childName ?? 'Your little one'} will see this face, so smile! 😊`}
      footer={
        unavailable ? undefined : (
          <div className="flex items-center justify-center gap-8">
            {gallery}
            <button
              type="button"
              aria-label="Take photo"
              disabled={status !== 'live'}
              onClick={() => void snap()}
              className="grid h-[76px] w-[76px] place-items-center rounded-full border-4 border-ink bg-coral shadow-chunky transition-transform active:translate-y-[3px] active:shadow-none disabled:opacity-50"
            >
              <span aria-hidden="true" className="h-[54px] w-[54px] rounded-full border-2 border-white/70" />
            </button>
            <button
              type="button"
              aria-label="Flip camera"
              onClick={flip}
              className="grid h-14 w-14 place-items-center rounded-full border-2 border-ink bg-white text-[24px] active:bg-sun/40"
            >
              <span aria-hidden="true">🔄</span>
            </button>
          </div>
        )
      }
    >
      {unavailable ? (
        <div className="flex flex-col items-center gap-4 rounded-[24px] bg-lilac px-5 py-7 text-center">
          <Illustration asset="onboarding.avatarPhoto" size={132} priority />
          <div>
            <p className="text-[18px] font-semibold">Let's use your phone's camera</p>
            <p className="mt-1 text-[14px] leading-snug text-mutedText">We couldn't open the live camera here. No problem, you can take a photo or pick one you already love.</p>
          </div>
          <div className="flex w-full flex-col gap-3">
            <Button fullWidth size="lg" icon="📸" onClick={() => void pick('camera')}>
              Open the camera
            </Button>
            <Button fullWidth variant="white" icon="🖼️" onClick={() => void pick('gallery')}>
              Choose from your photos
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="relative aspect-[3/4] w-full overflow-hidden rounded-[24px] border-[3px] border-ink bg-ink">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              aria-label="Live camera"
              className={clsx('h-full w-full object-cover transition-opacity duration-300', facing === 'user' && '-scale-x-100', status === 'live' ? 'opacity-100' : 'opacity-0')}
            />
            {status === 'starting' ? <p className="absolute inset-0 grid place-items-center text-[15px] text-white/80">Waking up the camera… 📷</p> : null}
            <svg viewBox="0 0 100 133" aria-hidden="true" className="pointer-events-none absolute inset-x-[12%] bottom-0 top-[8%] h-[84%] w-[76%] text-sun">
              <ellipse cx="50" cy="36" rx="19" ry="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="4 3" strokeLinecap="round" />
              <path d="M10 133 C10 96 28 80 50 80 C72 80 90 96 90 133" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="4 3" strokeLinecap="round" />
            </svg>
            {lighting ? (
              <span
                role="status"
                className={clsx('absolute left-3 top-3 inline-flex min-h-[34px] items-center rounded-full border-2 border-ink px-3 text-[13px] font-medium text-ink', CHIP[lighting].cls)}
              >
                {CHIP[lighting].text}
              </span>
            ) : null}
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-ink/70 to-transparent" />
            <p className="absolute inset-x-0 bottom-3 text-center text-[13px] font-medium text-white">Fit your head &amp; shoulders in the outline</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex min-h-[34px] items-center rounded-full border-2 border-ink bg-mint px-3 text-[13px] font-medium">👀 Look at the camera</span>
            <span className="inline-flex min-h-[34px] items-center rounded-full border-2 border-ink bg-mint px-3 text-[13px] font-medium">📏 Phone at eye level</span>
          </div>
        </>
      )}
    </Step>
  );
}
