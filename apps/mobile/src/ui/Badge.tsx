import type { ReactNode } from 'react';
import clsx from 'clsx';

export type BadgeTone = 'neutral' | 'mint' | 'sun' | 'coral' | 'sky' | 'lilac' | 'flag';

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-white text-ink border-line',
  mint: 'bg-mint text-mintInk border-mintD',
  sun: 'bg-sun text-ink border-sunD',
  coral: 'bg-coral text-ink border-coralD',
  sky: 'bg-sky text-ink border-skyD',
  lilac: 'bg-lilac text-ink border-transparent',
  flag: 'bg-flag text-danger border-coral',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  icon,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border-[1.5px] px-2.5 py-0.5 text-[12px] font-semibold leading-snug',
        tones[tone],
        className,
      )}
    >
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {children}
    </span>
  );
}
