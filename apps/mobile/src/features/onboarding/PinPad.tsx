import { useEffect, useRef } from 'react';
import { motion as fm, useAnimationControls } from 'framer-motion';
import clsx from 'clsx';
import { motion } from '../../theme/motion';
import { shadows } from '../../theme/tokens';
import { haptics } from '../../lib/native';

export interface PinPadProps {
  value: string;
  onChange: (v: string) => void;
  /** Called once, with the full PIN, the moment the last digit lands. */
  onComplete?: (pin: string) => void;
  length?: number;
  disabled?: boolean;
  /** Bump to shake the dots (reduced-motion aware through MotionRoot). */
  shake?: number;
  /** Describes what the PIN is for, for screen readers. */
  label?: string;
  /** Smaller keys and gaps, for short (landscape) screens where the big pad would not fit. */
  compact?: boolean;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

const keyBase = 'grid select-none place-items-center rounded-full border-btn border-ink bg-white font-semibold text-ink disabled:opacity-50';
const keySize = { big: 'h-[72px] w-[72px] text-[28px]', compact: 'h-[48px] w-[48px] text-[22px]' } as const;

/**
 * Big round-key PIN pad with filled dots. Controlled: the caller owns `value`. Shared by the join flow and the
 * classroom tablet PIN gate. Physical keyboards work too (digits and Backspace) for accessibility and testing.
 */
export function PinPad({ value, onChange, onComplete, length = 4, disabled, shake = 0, label = 'PIN', compact = false }: PinPadProps) {
  const keyCls = clsx(keyBase, compact ? keySize.compact : keySize.big);
  const controls = useAnimationControls();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (shake > 0) void controls.start({ x: [0, -12, 12, -9, 9, -4, 0], transition: { duration: 0.42 } });
  }, [shake, controls]);

  const add = (d: string) => {
    if (disabled || value.length >= length) return;
    haptics.light();
    const next = value + d;
    onChange(next);
    if (next.length === length) onComplete?.(next);
  };
  const del = () => {
    if (disabled || !value) return;
    haptics.light();
    onChange(value.slice(0, -1));
  };

  const press = (fn: () => void) => ({
    onClick: fn,
    whileTap: disabled ? undefined : { scale: 0.92, y: 2, boxShadow: shadows.chunkyPressed },
    transition: motion.press,
    style: { boxShadow: shadows.chunky },
  });

  return (
    <div
      className={clsx('flex flex-col items-center', compact ? 'gap-2' : 'gap-6')}
      onKeyDown={(e) => {
        if (/^\d$/.test(e.key)) add(e.key);
        else if (e.key === 'Backspace') del();
      }}
    >
      <fm.div
        animate={controls}
        role="img"
        aria-label={`${label}: ${value.length} of ${length} digits entered`}
        className={clsx('flex items-center gap-4', compact ? 'h-6' : 'h-8')}
      >
        {Array.from({ length }, (_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={clsx('h-5 w-5 rounded-full border-2 border-ink transition-colors duration-150', i < value.length ? 'bg-coral' : 'bg-white')}
          />
        ))}
      </fm.div>
      <div className={clsx('grid grid-cols-3', compact ? 'gap-x-4 gap-y-1.5' : 'gap-x-5 gap-y-4')}>
        {KEYS.map((d) => (
          <fm.button key={d} type="button" aria-label={d} disabled={disabled} className={keyCls} {...press(() => add(d))}>
            {d}
          </fm.button>
        ))}
        <span aria-hidden="true" className={compact ? 'h-[48px] w-[48px]' : 'h-[72px] w-[72px]'} />
        <fm.button type="button" aria-label="0" disabled={disabled} className={keyCls} {...press(() => add('0'))}>
          0
        </fm.button>
        <fm.button
          type="button"
          aria-label="Delete"
          disabled={disabled || !value}
          className={clsx(keyCls, 'bg-cream', compact ? 'text-[20px]' : 'text-[24px]')}
          {...press(del)}
        >
          <span aria-hidden="true">⌫</span>
        </fm.button>
      </div>
    </div>
  );
}
