import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { motion as fm } from 'framer-motion';
import clsx from 'clsx';
import { motion } from '../../theme/motion';
import { Screen } from '../../ui';

// ---- where the onboarding routes live --------------------------------------------------------------------------

const BaseCtx = createContext<string>('/onboarding');
export const OnboardingBaseProvider = BaseCtx.Provider;
/** Builds an absolute path under the onboarding base (the dev preview mounts the same screens elsewhere). */
export function useOnbPath(): (sub: string) => string {
  const base = useContext(BaseCtx);
  return (sub) => `${base}${sub === '/' ? '' : sub}`;
}

// ---- layout ----------------------------------------------------------------------------------------------------

/** "Step 2 of 3" progress pills, as in the mockups. */
export function Steps({ total, current }: { total: number; current: number }) {
  return (
    <div role="img" aria-label={`Step ${current} of ${total}`} className="mb-4 mt-1 flex gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <i key={i} aria-hidden="true" className={clsx('h-1.5 flex-1 rounded-full', i < current ? 'bg-coral' : 'bg-track')} />
      ))}
    </div>
  );
}

/** The screen heading. Focus lands here when a step appears so screen-reader and keyboard users start at the top. */
export function StepHeading({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <h1 ref={ref} tabIndex={-1} className={clsx('text-[26px] font-semibold leading-tight text-ink outline-none', className)}>
      {children}
    </h1>
  );
}

export interface StepProps {
  title: ReactNode;
  sub?: ReactNode;
  /** Illustration or emoji shown above the title. */
  hero?: ReactNode;
  back?: () => void;
  /** Sticky action area: the CTA lives here so the keyboard never hides it. */
  footer?: ReactNode;
  steps?: { total: number; current: number };
  bg?: 'cream' | 'sunGradient';
  center?: boolean;
  children?: ReactNode;
}

/** One screen of a flow: back arrow, progress, hero, heading, body, sticky footer; arrives with the page motion. */
export function Step({ title, sub, hero, back, footer, steps, bg = 'cream', center, children }: StepProps) {
  return (
    <Screen bg={bg} back={back} footer={footer}>
      <fm.div {...motion.page} className={clsx('flex min-h-full flex-col', !back && 'pt-3')}>
        {steps ? <Steps {...steps} /> : null}
        {hero ? <div className={clsx('mb-3 flex', center ? 'justify-center' : 'justify-start')}>{hero}</div> : null}
        <StepHeading className={center ? 'text-center' : undefined}>{title}</StepHeading>
        {sub ? <p className={clsx('mt-1.5 text-[16px] leading-snug text-mutedText', center && 'text-center')}>{sub}</p> : null}
        <div className="mt-5 flex flex-col gap-4">{children}</div>
      </fm.div>
    </Screen>
  );
}

/** Warm inline failure with a Retry, for async steps that can fail. */
export function InlineError({ message, onRetry, retrying }: { message: string; onRetry?: () => void; retrying?: boolean }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-card border-2 border-coral bg-flag px-4 py-3 text-[14px] font-medium text-ink">
      <span className="flex items-start gap-2">
        <span aria-hidden="true">🫣</span>
        <span>{message}</span>
      </span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="min-h-[44px] shrink-0 rounded-btn border-2 border-ink bg-white px-4 text-[14px] font-semibold disabled:opacity-60"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
