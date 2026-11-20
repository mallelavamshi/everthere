import type { HTMLAttributes, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { motion as fm } from 'framer-motion';
import clsx from 'clsx';
import { motion } from '../theme/motion';
import { shadows } from '../theme/tokens';

export type CardTone = 'white' | 'sun' | 'mint' | 'sky' | 'flag';

export interface CardProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'> {
  tone?: CardTone;
  /** Raised look: ink border + hard bottom shadow. Tappable cards (with onClick) also press down. */
  lift?: boolean;
  children?: ReactNode;
}

const base: Record<CardTone, string> = {
  white: 'bg-white border-card border-line',
  sun: 'bg-sun border-btn border-ink',
  mint: 'bg-mint border-card border-transparent',
  sky: 'bg-sky border-card border-transparent',
  flag: 'bg-flag border-card border-coral',
};

const resting: Record<CardTone, string> = {
  white: 'none',
  sun: shadows.chunky,
  mint: shadows.mint,
  sky: shadows.sky,
  flag: 'none',
};

export function Card({ tone = 'white', lift, onClick, onKeyDown, className, children, ...props }: CardProps) {
  const tappable = !!onClick;
  const shadow = lift ? shadows.chunky : resting[tone];
  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (tappable && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onClick?.(e as unknown as MouseEvent<HTMLDivElement>);
    }
  };
  const hardShadow = lift || tone === 'sun';
  return (
    <fm.div
      {...(props as object)}
      role={tappable ? 'button' : props.role}
      tabIndex={tappable ? 0 : props.tabIndex}
      onClick={onClick as never}
      onKeyDown={handleKey as never}
      initial={false}
      animate={{ y: 0, boxShadow: shadow }}
      whileTap={tappable ? { y: hardShadow ? 3 : 1, boxShadow: hardShadow ? shadows.chunkyPressed : 'none' } : undefined}
      transition={motion.press}
      className={clsx(
        'rounded-card p-4 text-ink',
        base[tone],
        lift && tone === 'white' && 'border-btn border-ink',
        tappable && 'min-h-touch cursor-pointer select-none',
        className,
      )}
    >
      {children}
    </fm.div>
  );
}
