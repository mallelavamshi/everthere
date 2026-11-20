import { forwardRef, type ReactNode } from 'react';
import { motion as fm, type HTMLMotionProps } from 'framer-motion';
import clsx from 'clsx';
import { motion } from '../theme/motion';
import { shadows } from '../theme/tokens';
import { haptics } from '../lib/native';
import { Spinner } from './Spinner';

export type ButtonVariant = 'sun' | 'coral' | 'white' | 'ghost';
export type ButtonSize = 'lg' | 'md' | 'sm';

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children' | 'ref'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Leading icon (emoji or element). */
  icon?: ReactNode;
  /** Light haptic tick on press (default off). */
  haptic?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
}

const variants: Record<ButtonVariant, string> = {
  sun: 'bg-sun text-ink border-btn border-ink',
  coral: 'bg-coral text-ink border-btn border-ink',
  white: 'bg-white text-ink border-btn border-ink',
  ghost: 'bg-transparent text-ink border-btn border-transparent',
};

// min-h values keep every size at or above the 44px touch target.
const sizes: Record<ButtonSize, string> = {
  lg: 'min-h-[56px] px-6 text-[17px]',
  md: 'min-h-[48px] px-5 text-[15px]',
  sm: 'min-h-[44px] px-4 text-[14px]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'sun', size = 'md', loading = false, icon, haptic = false, fullWidth, disabled, onClick, className, children, type = 'button', ...rest },
  ref,
) {
  const inert = disabled || loading;
  const chunky = variant !== 'ghost';
  return (
    <fm.button
      ref={ref}
      type={type}
      disabled={inert}
      aria-busy={loading || undefined}
      onClick={(e) => {
        if (inert) return;
        if (haptic) haptics.light();
        onClick?.(e);
      }}
      initial={false}
      animate={{ y: 0, boxShadow: chunky ? shadows.chunky : 'none' }}
      whileTap={inert ? undefined : chunky ? motion.pressed : { scale: 0.96 }}
      transition={motion.press}
      className={clsx(
        'relative inline-flex select-none items-center justify-center gap-2 rounded-btn font-semibold leading-none',
        'disabled:cursor-not-allowed',
        inert && !loading && 'opacity-55',
        loading && 'cursor-progress',
        variants[variant],
        sizes[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={size === 'lg' ? 22 : 18} /> : icon ? <span aria-hidden="true" className="text-[1.15em] leading-none">{icon}</span> : null}
      <span>{children}</span>
    </fm.button>
  );
});
