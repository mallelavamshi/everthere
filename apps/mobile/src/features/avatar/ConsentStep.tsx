import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Button, Field, Illustration } from '../../ui';
import { Step } from '../onboarding/Step';

/** Spec section 7 wording. Do not paraphrase: this is what the parent agrees to. */
export const CONSENT_COPY =
  'I confirm this avatar is an AI version of me, and I consent to my likeness and voice being used to comfort my child through EverThere. I can delete it anytime.';

export interface ConsentStepProps {
  onSubmit: (v: { consentName: string }) => void;
  onBack?: () => void;
  steps?: { total: number; current: number } | null;
  busy?: boolean;
  error?: string | null;
  initialName?: string;
  ctaLabel?: string;
  /** Extra fields shown above the legal name (e.g. what the child calls the parent). */
  before?: ReactNode;
  /** Extra gating from the parent screen (e.g. a missing title). */
  blocked?: boolean;
}

/** Full legal name (trimmed, non-empty) plus the checkbox. Nothing is sent until both are done. */
export function ConsentStep({ onSubmit, onBack, steps = { total: 3, current: 3 }, busy, error, initialName = '', ctaLabel = 'Create my avatar ✨', before, blocked }: ConsentStepProps) {
  const [name, setName] = useState(initialName);
  const [agreed, setAgreed] = useState(false);
  const trimmed = name.trim();
  const ready = trimmed !== '' && agreed && !blocked;

  return (
    <Step
      steps={steps ?? undefined}
      back={onBack}
      hero={<Illustration asset="onboarding.avatarConsent" size={96} priority />}
      title="One last thing"
      sub="Your face and voice are yours. We need your OK to use them."
      footer={
        <div className="flex flex-col gap-2">
          {error ? (
            <p role="alert" className="rounded-card border-2 border-coral bg-flag px-4 py-2 text-[14px] font-medium">
              🫣 {error}
            </p>
          ) : null}
          <Button size="lg" fullWidth haptic disabled={!ready} loading={busy} onClick={() => onSubmit({ consentName: trimmed })}>
            {ctaLabel}
          </Button>
        </div>
      }
    >
      {before}
      <Field
        label="Your full legal name"
        autoComplete="name"
        autoCapitalize="words"
        value={name}
        onChange={(e) => setName(e.target.value)}
        hint="Exactly as it appears on your ID."
      />
      <label className="flex cursor-pointer items-start gap-3 rounded-card bg-lilac px-4 py-4">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="peer sr-only" />
        <span
          aria-hidden="true"
          className={clsx(
            'mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border-2 border-ink text-[18px] font-bold peer-focus-visible:shadow-focus',
            agreed ? 'bg-sun' : 'bg-white',
          )}
        >
          {agreed ? '✓' : ''}
        </span>
        <span className="text-[15px] leading-snug">{CONSENT_COPY}</span>
      </label>
    </Step>
  );
}
