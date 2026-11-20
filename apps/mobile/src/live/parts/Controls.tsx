import type { ReactNode } from 'react';
import { motion as fm } from 'framer-motion';
import clsx from 'clsx';

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex max-w-full items-center gap-1.5 rounded-full border-2 border-ink bg-white px-3 py-1.5 text-[14px] font-semibold leading-tight text-ink', className)}>
      {children}
    </span>
  );
}

export interface ControlProps {
  icon: string;
  label: string;
  onClick: () => void;
  tone?: 'white' | 'sun' | 'coral';
  pressed?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}

/**
 * A round call control with its label underneath. Sized in px, not rem, so Android's large system text can only grow
 * the label, never the circle: five of them share a 360 px-wide dock at 1.0x-1.5x text (task 26c). The circle (52px)
 * is the tap target's floor; the label (13px) takes the button's width and ends in an ellipsis rather than wrapping,
 * and the full name is the button's `title`, so a truncated label can still be discovered.
 */
export function Control({ icon, label, onClick, tone = 'white', pressed, disabled, ariaLabel }: ControlProps) {
  const bg = pressed ? 'bg-sun' : tone === 'coral' ? 'bg-coral' : tone === 'sun' ? 'bg-sun' : 'bg-white';
  return (
    <fm.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? label}
      title={ariaLabel ?? label}
      aria-pressed={pressed}
      whileTap={disabled ? undefined : { scale: 0.92 }}
      className="live-control flex min-h-[44px] min-w-[44px] flex-col items-center gap-[4px] disabled:opacity-50"
    >
      <span aria-hidden="true" className={clsx('grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full border-btn border-ink text-[23px] leading-none shadow-chunky', bg)}>
        {icon}
      </span>
      <span className="live-control-label font-semibold text-ink">{label}</span>
    </fm.button>
  );
}
