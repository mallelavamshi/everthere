import { useId, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import { Chip, type ChipTone } from '../../ui';

export const CHIP_MAX = 12;
export const CHIP_LEN = 40;

export interface ChipSuggestion {
  label: string;
  /** An emoji or a sticker element, shown on the chip. */
  icon?: ReactNode;
}

export interface ChipInputProps {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  /** One-tap ideas; each adds itself and then disappears. */
  suggestions?: ChipSuggestion[];
  tone?: ChipTone;
  placeholder?: string;
  max?: number;
  maxLength?: number;
  error?: string;
  /** Overrides the label as the visible heading (e.g. when the screen already has a section title). */
  hideLabel?: boolean;
  className?: string;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Splits typed or pasted text on commas and line breaks, trims, and clips each piece to the length limit. */
function pieces(text: string, maxLength: number): string[] {
  return text
    .split(/[,\n\r;]+/)
    .map((p) => p.trim().slice(0, maxLength).trim())
    .filter(Boolean);
}

/**
 * Chips, not forms: Enter or comma adds what you typed, pasting "a, b, c" adds three, tapping a suggestion adds it.
 * Entries are trimmed, duplicates (case-insensitive) are dropped, and the list stops at `max` with a friendly hint.
 */
export function ChipInput({ label, values, onChange, suggestions, tone = 'neutral', placeholder, max = CHIP_MAX, maxLength = CHIP_LEN, error, hideLabel, className }: ChipInputProps) {
  const uid = useId();
  const [draft, setDraft] = useState('');
  const full = values.length >= max;

  const iconFor = (v: string) => suggestions?.find((s) => norm(s.label) === norm(v))?.icon;

  /** Adds as many of `items` as fit, in order. Returns what happened so callers can keep leftover text. */
  const add = (items: string[]) => {
    const next = [...values];
    for (const item of items) {
      if (next.length >= max) break;
      if (next.some((v) => norm(v) === norm(item))) continue;
      next.push(item);
    }
    if (next.length !== values.length) onChange(next);
  };

  const commit = (text: string) => {
    // At the limit nothing can be added: keep what was typed (the "That's plenty!" hint explains why).
    if (full) {
      setDraft(text);
      return;
    }
    add(pieces(text, maxLength));
    setDraft('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(draft);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!/[,\n\r;]/.test(text) && text.trim().length <= maxLength) return; // a plain word: let it land in the box
    e.preventDefault();
    commit(draft + text);
  };

  const remaining = (suggestions ?? []).filter((s) => !values.some((v) => norm(v) === norm(s.label)));
  const labelId = `${uid}-label`;
  const hintId = `${uid}-hint`;
  const errId = `${uid}-err`;

  return (
    <div role="group" aria-labelledby={labelId} className={clsx('flex flex-col gap-2', className)}>
      <span id={labelId} className={hideLabel ? 'sr-only' : 'text-[13px] font-semibold uppercase tracking-[0.06em] text-mutedText'}>
        {label}
      </span>

      {values.length ? (
        <ul className="flex flex-wrap gap-2" aria-label={`${label}, added`}>
          {values.map((v) => (
            <li key={norm(v)} className="max-w-full">
              <Chip tone={tone} icon={iconFor(v)} onRemove={() => onChange(values.filter((x) => x !== v))}>
                {v}
              </Chip>
            </li>
          ))}
        </ul>
      ) : null}

      <input
        type="text"
        enterKeyHint="done"
        value={draft}
        maxLength={maxLength}
        aria-label={`Add to ${label}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={[full ? hintId : null, error ? errId : null].filter(Boolean).join(' ') || undefined}
        placeholder={full ? "That's plenty!" : (placeholder ?? 'Type and press enter')}
        autoCapitalize="sentences"
        autoComplete="off"
        onChange={(e) => {
          const v = e.target.value;
          // Some mobile keyboards deliver the comma as text rather than as a key event.
          if (v.includes(',')) commit(v);
          else setDraft(v);
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => draft.trim() && commit(draft)}
        className={clsx(
          'min-h-[48px] w-full rounded-seg border-2 bg-white px-4 text-[16px] text-ink placeholder:text-muted',
          'focus:border-ink focus:outline-none focus:shadow-focus',
          error ? 'border-danger' : 'border-ink/80',
        )}
      />

      {/* Live regions exist before their text does, so the hint is announced the moment it appears. */}
      <div role="status" aria-live="polite" id={hintId}>
        {full ? <p className="text-[13px] font-medium text-mintInk">That's plenty!</p> : null}
      </div>
      {error ? (
        <p id={errId} role="alert" className="flex items-start gap-1 text-[13px] font-medium text-danger">
          <span aria-hidden="true">⚠️</span>
          <span>{error}</span>
        </p>
      ) : null}

      {remaining.length && !full ? (
        <div role="group" aria-label={`Ideas for ${label}`} className="flex flex-wrap gap-2">
          {remaining.map((s) => (
            <Chip key={s.label} tone="add" icon={s.icon} onClick={() => add([s.label])}>
              {s.label}
            </Chip>
          ))}
        </div>
      ) : null}
    </div>
  );
}
