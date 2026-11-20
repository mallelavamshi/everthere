import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { VOICES, type Voice } from '@everthere/shared';
import { Button, Illustration } from '../../ui';
import { Step } from '../onboarding/Step';
import { CLIPS, VOICE_INFO, type VoiceClips } from './voices';

export interface VoiceStepProps {
  value: Voice | null;
  onChange: (v: Voice) => void;
  onNext: () => void;
  onBack?: () => void;
  steps?: { total: number; current: number } | null;
  /** Preview clips by voice id. Defaults to whatever is bundled in src/assets/voices (currently none). */
  clips?: VoiceClips;
  ctaLabel?: string;
  busy?: boolean;
  error?: string | null;
}

function PlayButton({ voice, src, playing, onToggle }: { voice: Voice; src: string; playing: boolean; onToggle: (v: Voice | null, src?: string) => void }) {
  return (
    <button
      type="button"
      aria-label={`${playing ? 'Stop' : 'Play'} ${VOICE_INFO[voice].label}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(playing ? null : voice, src);
      }}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-ink bg-white text-[16px] active:bg-sun/40"
    >
      <span aria-hidden="true">{playing ? '⏸' : '▶'}</span>
    </button>
  );
}

/** Ten voices as little personalities. Previews play only for voices that have a bundled clip. */
export function VoiceStep({ value, onChange, onNext, onBack, steps = { total: 3, current: 2 }, clips = CLIPS, ctaLabel = 'Continue', busy, error }: VoiceStepProps) {
  const [playing, setPlaying] = useState<Voice | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(
    () => () => {
      audio.current?.pause();
      audio.current = null;
    },
    [],
  );

  const toggle = (v: Voice | null, src?: string) => {
    audio.current?.pause();
    setPlaying(v);
    if (v && src) {
      const a = new Audio(src);
      a.onended = () => setPlaying(null);
      audio.current = a;
      void a.play().catch(() => setPlaying(null));
    }
  };

  return (
    <Step
      steps={steps ?? undefined}
      back={onBack}
      title="Pick your voice"
      sub="Choose the voice that feels most like a hug from you."
      footer={
        <div className="flex flex-col gap-2">
          {error ? (
            <p role="alert" className="rounded-card border-2 border-coral bg-flag px-4 py-2 text-[14px] font-medium">
              🫣 {error}
            </p>
          ) : null}
          <Button size="lg" fullWidth haptic disabled={!value} loading={busy} onClick={onNext}>
            {ctaLabel}
          </Button>
        </div>
      }
    >
      <p className="-mt-2 inline-flex items-center gap-2 self-start rounded-full bg-sky px-4 py-2 text-[14px] font-medium">You'll hear it in your test call 🎧</p>
      <div role="radiogroup" aria-label="Voice" className="flex flex-col gap-3">
        {VOICES.map((v) => {
          const info = VOICE_INFO[v];
          const on = value === v;
          const clip = clips[v];
          return (
            <div key={v} className="flex items-center gap-2">
              <button
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange(v)}
                className={clsx(
                  'flex min-h-[64px] flex-1 items-center gap-3 rounded-card border-2 px-4 py-2 text-left transition-colors',
                  on ? 'border-ink bg-sun shadow-chunky' : 'border-line bg-white',
                )}
              >
                <span aria-hidden="true" className={clsx('grid h-11 w-11 shrink-0 place-items-center rounded-full text-[22px]', on ? 'bg-white' : 'bg-cream')}>
                  {info.emoji}
                </span>
                <span className="flex flex-col">
                  <span className="text-[17px] font-semibold leading-tight">{info.label}</span>
                  <span className="text-[14px] text-mutedText">{info.descriptor}</span>
                </span>
                <span aria-hidden="true" className="ml-auto text-[20px]">
                  {on ? '✓' : ''}
                </span>
              </button>
              {clip ? <PlayButton voice={v} src={clip} playing={playing === v} onToggle={toggle} /> : null}
            </div>
          );
        })}
        <div className="flex min-h-[72px] items-center gap-3 rounded-card bg-lilac px-4 py-3">
          <Illustration asset="sticker.rainbow" size={48} />
          <div className="flex flex-col">
            <span className="text-[16px] font-semibold leading-tight">Record your real voice</span>
            <span className="text-[13px] text-mutedText">Coming soon, so your avatar can sound exactly like you 💜</span>
          </div>
        </div>
      </div>
    </Step>
  );
}
