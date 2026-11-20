import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { FLAG_CATEGORIES, type FlagCategory, type Severity } from '@everthere/shared';
import { ApiError, friendlyMessage } from '../../lib/api';
import { haptics } from '../../lib/native';
import { Button, Field, Segmented, Sheet, toast } from '../../ui';

export const FLAG_LABELS: Record<FlagCategory, { label: string; icon: string }> = {
  injury: { label: 'Hurt themselves', icon: '🩹' },
  illness: { label: 'Feeling sick', icon: '🤒' },
  hurt_by_someone: { label: 'Hurt by someone', icon: '😢' },
  scared_of_person: { label: 'Scared of someone', icon: '😟' },
  unsafe: { label: 'Feels unsafe', icon: '⚠️' },
  other: { label: 'Something else', icon: '💬' },
};

const SEVERITY_OPTIONS: { value: Severity; label: string }[] = [
  { value: 'low', label: 'A little' },
  { value: 'medium', label: 'Some worry' },
  { value: 'high', label: 'Serious' },
];

/** Manual flag: category chips, severity and a quote. Only grown-ups see it; the call keeps going. */
export function FlagSheet({ open, onClose, parentTitle, onSubmit }: { open: boolean; onClose: () => void; parentTitle: string; onSubmit: (c: FlagCategory, quote: string, s: Severity) => Promise<void> }) {
  const [category, setCategory] = useState<FlagCategory | null>(null);
  const [severity, setSeverity] = useState<Severity>('medium');
  const [quote, setQuote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setCategory(null);
    setSeverity('medium');
    setQuote('');
    setError(undefined);
  }, [open]);

  const save = async () => {
    if (!category) return setError('Pick what it is about first.');
    if (!quote.trim()) return setError('Add a few words about what happened.');
    setSaving(true);
    setError(undefined);
    try {
      await onSubmit(category, quote.trim(), severity);
      haptics.success();
      toast.success(`Flag saved. ${parentTitle} will see it 💛`);
      onClose();
    } catch (e) {
      setError(friendlyMessage(e instanceof ApiError ? e.code : 'INTERNAL'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Flag something for ${parentTitle}`}
      footer={
        <Button fullWidth size="lg" variant="coral" loading={saving} onClick={() => void save()} icon="⚑">
          Save flag
        </Button>
      }
    >
      <p className="mb-3 text-[15px] leading-relaxed text-mutedText">Only grown-ups see this. The call keeps going.</p>
      <div role="group" aria-label="What is it about?" className="mb-4 flex flex-wrap gap-x-1.5 gap-y-2.5">
        {FLAG_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
            className={clsx(
              'inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-2 border-ink px-3.5 text-[15px] font-medium text-ink',
              category === c ? 'bg-sun' : 'bg-white',
            )}
          >
            <span aria-hidden="true">{FLAG_LABELS[c].icon}</span>
            {FLAG_LABELS[c].label}
          </button>
        ))}
      </div>
      <p className="mb-1.5 text-[13px] font-semibold uppercase tracking-[0.06em] text-mutedText">How worried are you?</p>
      <Segmented aria-label="How worried are you?" options={SEVERITY_OPTIONS} value={severity} onChange={setSeverity} className="mb-4" />
      <Field
        multiline
        label="What happened or what did they say?"
        value={quote}
        maxLength={1000}
        onChange={(e) => setQuote(e.target.value)}
        error={error}
        placeholder="e.g. Said their tummy hurts after lunch"
      />
    </Sheet>
  );
}

export function VolumeSheet({ open, onClose, volume, onChange }: { open: boolean; onClose: () => void; volume: number; onChange: (v: number) => void }) {
  const pct = Math.round(volume * 100);
  return (
    <Sheet open={open} onClose={onClose} title="Volume">
      <div className="flex items-center gap-3 py-3">
        <span aria-hidden="true" className="text-[22px]">🔈</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={pct}
          aria-label="Avatar volume"
          aria-valuetext={`${pct} percent`}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
          className="h-11 min-w-0 flex-1 accent-coral"
        />
        <span aria-hidden="true" className="text-[22px]">🔊</span>
      </div>
      <p className="pb-2 text-center text-[15px] font-semibold text-ink">{pct}%</p>
    </Sheet>
  );
}
