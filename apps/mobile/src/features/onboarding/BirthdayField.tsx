import { Field } from '../../ui';
import { birthdayBounds, scrollIntoViewSoon } from './lib';

/**
 * A child's birthday: a native date input limited to the last 12 years. An empty field is set to about 3 years ago
 * the moment it is opened, so the picker starts near a typical daycare age instead of on today.
 */
export function BirthdayField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  const b = birthdayBounds();
  const startNearby = () => {
    if (!value) onChange(b.start);
  };
  return (
    <Field
      label="Birthday"
      type="date"
      max={b.max}
      min={b.min}
      value={value}
      error={error}
      onChange={(e) => onChange(e.target.value)}
      onPointerDown={startNearby}
      onFocus={(e) => {
        startNearby();
        scrollIntoViewSoon(e.currentTarget);
      }}
    />
  );
}
