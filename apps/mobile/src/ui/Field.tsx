import { useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';

type Shared = {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
};

export type FieldProps =
  | (Shared & { multiline?: false } & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>)
  | (Shared & { multiline: true } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>);

export function Field(props: FieldProps) {
  const { label, hint, error, className, multiline, ...rest } = props;
  const uid = useId();
  const id = (rest as { id?: string }).id ?? uid;
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [hint ? hintId : null, error ? errId : null].filter(Boolean).join(' ') || undefined;

  const control = clsx(
    'w-full rounded-seg border-2 bg-white px-4 text-[16px] text-ink placeholder:text-muted',
    'focus:border-ink focus:outline-none focus:shadow-focus',
    error ? 'border-danger' : 'border-ink/80',
    multiline ? 'min-h-[104px] py-3 leading-relaxed' : 'min-h-[52px]',
  );

  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-semibold uppercase tracking-[0.06em] text-mutedText">
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={control}
          {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)}
        />
      ) : (
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={control}
          {...(rest as InputHTMLAttributes<HTMLInputElement>)}
        />
      )}
      {hint && !error ? (
        <p id={hintId} className="text-[13px] text-mutedText">
          {hint}
        </p>
      ) : null}
      {hint && error ? (
        <p id={hintId} className="sr-only">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errId} role="alert" className="flex items-start gap-1 text-[13px] font-medium text-danger">
          <span aria-hidden="true">⚠️</span>
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
