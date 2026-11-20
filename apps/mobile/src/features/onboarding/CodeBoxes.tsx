import { useAnimationControls, motion as fm } from 'framer-motion';
import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import clsx from 'clsx';
import { normalizeCode } from './lib';

export interface CodeBoxesProps {
  value: string;
  onChange: (v: string) => void;
  length?: number;
  /** 'code' = the invite alphabet, 'digits' = 0-9 (email codes). */
  mode?: 'code' | 'digits';
  /** Accessible name of the whole group. */
  label: string;
  error?: string;
  /** Bump to shake the boxes (reduced-motion users get the red border and message only). */
  shake?: number;
  autoFocus?: boolean;
  disabled?: boolean;
}

const clamp = (raw: string, mode: 'code' | 'digits', length: number) =>
  mode === 'digits' ? raw.replace(/\D/g, '').slice(0, length) : normalizeCode(raw, length);

/**
 * Six big boxes for a short code. Typing auto-advances, backspace on an empty box steps back, and pasting (or an
 * SMS/email autofill, which arrives as several characters at once) fills every box. The value is a plain string that
 * fills left to right, so there are never holes.
 */
export function CodeBoxes({ value, onChange, length = 6, mode = 'code', label, error, shake = 0, autoFocus, disabled }: CodeBoxesProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const controls = useAnimationControls();
  const mounted = useRef(false);
  // Latest value, updated eagerly: a focus handler can run before React re-renders with the new value.
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (shake > 0 && latest.current === '') focus(0);
    if (shake > 0) void controls.start({ x: [0, -10, 10, -8, 8, -4, 0], transition: { duration: 0.42 } });
  }, [shake, controls]);

  useEffect(() => {
    if (autoFocus) refs.current[Math.min(value.length, length - 1)]?.focus();
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const focus = (i: number) => refs.current[Math.max(0, Math.min(length - 1, i))]?.focus();

  const put = (i: number, raw: string) => {
    const chars = clamp(raw, mode, length);
    if (!chars) return;
    const at = Math.min(i, latest.current.length); // an empty box further right can only continue the string
    const cur = latest.current;
    const next = (cur.slice(0, at) + chars + cur.slice(at + chars.length)).slice(0, length);
    latest.current = next;
    onChange(next);
    focus(Math.min(at + chars.length, length - 1));
  };

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (i < value.length) {
        latest.current = value.slice(0, i) + value.slice(i + 1);
        onChange(latest.current);
        focus(i);
      } else if (i > 0) {
        latest.current = value.slice(0, i - 1);
        onChange(latest.current);
        focus(i - 1);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focus(i - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      focus(i + 1);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const text = clamp(e.clipboardData.getData('text'), mode, length);
    if (!text) return;
    latest.current = text;
    onChange(text);
    focus(Math.min(text.length, length - 1));
  };

  return (
    <div role="group" aria-label={label} className="flex flex-col items-center gap-2">
      <fm.div animate={controls} className="flex justify-center gap-2">
        {Array.from({ length }, (_, i) => {
          const filled = i < value.length;
          return (
            <input
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="text"
              inputMode={mode === 'digits' ? 'numeric' : 'text'}
              autoComplete={i === 0 ? 'one-time-code' : 'off'}
              autoCapitalize={mode === 'code' ? 'characters' : 'off'}
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint={i === length - 1 ? 'done' : 'next'}
              aria-label={`${label}, character ${i + 1} of ${length}`}
              aria-invalid={error ? true : undefined}
              disabled={disabled}
              value={value[i] ?? ''}
              onFocus={(e) => {
                if (i > latest.current.length) focus(latest.current.length);
                else e.currentTarget.select();
              }}
              onKeyDown={(e) => onKeyDown(i, e)}
              onPaste={onPaste}
              onChange={(e) => put(i, e.target.value)}
              className={clsx(
                'h-[60px] w-[46px] rounded-seg border-2 bg-white text-center text-[26px] font-semibold uppercase text-ink caret-coral',
                'focus:border-ink focus:shadow-focus focus:outline-none',
                error ? 'border-danger' : filled ? 'border-ink' : 'border-ink/40',
                disabled && 'opacity-60',
              )}
            />
          );
        })}
      </fm.div>
      {error ? (
        <p role="alert" className="flex items-start gap-1 text-center text-[14px] font-medium text-danger">
          <span aria-hidden="true">⚠️</span>
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
