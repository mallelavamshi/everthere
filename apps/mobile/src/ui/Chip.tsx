import type { ReactNode } from 'react';
import clsx from 'clsx';

export type ChipTone = 'neutral' | 'mint' | 'coral' | 'sky' | 'lilac' | 'add';

export interface ChipProps {
  children: ReactNode;
  selected?: boolean;
  tone?: ChipTone;
  icon?: ReactNode;
  onClick?: () => void;
  onRemove?: () => void;
  /** Overrides the default "Remove <label>" accessible name. */
  removeLabel?: string;
  className?: string;
}

const tones: Record<ChipTone, string> = {
  neutral: 'bg-white border-ink text-ink',
  mint: 'bg-mint border-ink text-ink',
  coral: 'bg-white border-coral text-ink',
  sky: 'bg-sky border-ink text-ink',
  lilac: 'bg-lilac border-ink text-ink',
  add: 'bg-transparent border-dashed border-muted text-mutedText',
};

// The visible chip is ~34px tall, so each interactive part gets an invisible 44px-tall hit area centred on it
// (::before). Hit areas are exactly as wide as their own button (before:w-full) so they never overhang
// sideways into a neighbour: the label button and the remove button sit side by side and cannot overlap.
// The remove button is a real 44px wide (w-11) for the same reason, instead of a 24px box with a wider overhang.
const hit =
  "relative before:absolute before:left-0 before:top-1/2 before:h-11 before:w-full before:-translate-y-1/2 before:content-['']";

export function Chip({ children, selected, tone = 'neutral', icon, onClick, onRemove, removeLabel, className }: ChipProps) {
  const label = typeof children === 'string' ? children : undefined;
  const body = (
    <>
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      <span>{children}</span>
    </>
  );
  return (
    <span
      className={clsx(
        'inline-flex max-w-full items-center gap-1 rounded-full border-2 text-[14px] font-medium leading-tight transition-colors',
        selected ? 'border-ink bg-sun text-ink' : tones[tone],
        onRemove ? 'py-1 pl-3 pr-0' : 'px-3 py-1',
        className,
      )}
    >
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          aria-pressed={selected === undefined ? undefined : selected}
          className={clsx(hit, 'inline-flex items-center gap-1 py-0.5 text-left', !onRemove && 'before:min-w-11')}
        >
          {body}
        </button>
      ) : (
        <span className="inline-flex items-center gap-1 py-0.5">{body}</span>
      )}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel ?? (label ? `Remove ${label}` : 'Remove')}
          className={clsx(hit, 'group grid h-6 w-11 place-items-center text-[13px] leading-none')}
        >
          <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-full group-hover:bg-ink/10">✕</span>
        </button>
      ) : null}
    </span>
  );
}
