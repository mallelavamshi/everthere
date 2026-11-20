import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Field, Sheet } from '../../ui';
import { US_ZONES, allZones, friendlyZone } from './lib';

function Option({ label, note, selected, onPick }: { label: string; note?: string; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onPick}
      className={clsx(
        'flex min-h-[52px] w-full items-center justify-between gap-3 rounded-seg border-2 px-4 text-left text-[16px] font-medium',
        selected ? 'border-ink bg-sun' : 'border-line bg-white',
      )}
    >
      <span>
        {label}
        {note ? <span className="ml-2 text-[13px] font-normal text-mutedText">{note}</span> : null}
      </span>
      <span aria-hidden="true">{selected ? '✓' : ''}</span>
    </button>
  );
}

/**
 * A friendly time-zone picker: shows "Eastern Time", opens a sheet with the six US zones first and a search for
 * everything else the device knows. The value is always a real IANA id.
 */
export function TimezonePicker({ value, onChange, label = 'Time zone' }: { value: string; onChange: (tz: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const zones = useMemo(() => allZones(), []);
  const isUs = US_ZONES.some((z) => z.id === value);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/\s+/g, '_');
    if (needle.length < 2) return [];
    return zones.filter((z) => z.toLowerCase().includes(needle) && !US_ZONES.some((u) => u.id === z)).slice(0, 30);
  }, [q, zones]);

  const pick = (tz: string) => {
    onChange(tz);
    setOpen(false);
    setQ('');
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold uppercase tracking-[0.06em] text-mutedText">{label}</span>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="flex min-h-[52px] w-full items-center justify-between gap-2 rounded-seg border-2 border-ink/80 bg-white px-4 text-left text-[16px] text-ink"
      >
        <span>
          <span aria-hidden="true">🕐 </span>
          {friendlyZone(value)}
        </span>
        <span aria-hidden="true" className="text-mutedText">
          ▾
        </span>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Choose your time zone">
        <div role="radiogroup" aria-label="Time zone" className="flex flex-col gap-2 pb-3">
          {!isUs ? <Option label={friendlyZone(value)} note="this device" selected onPick={() => pick(value)} /> : null}
          {US_ZONES.map((z) => (
            <Option key={z.id} label={z.label} selected={z.id === value} onPick={() => pick(z.id)} />
          ))}
        </div>
        <Field label="Somewhere else?" placeholder="Search, like “London” or “Tokyo”" value={q} onChange={(e) => setQ(e.target.value)} type="search" enterKeyHint="search" />
        {q.trim().length >= 2 ? (
          <div role="radiogroup" aria-label="Search results" className="mt-3 flex flex-col gap-2 pb-2">
            {results.length === 0 ? <p className="py-2 text-[14px] text-mutedText">No match. Try a nearby city 🌍</p> : null}
            {results.map((z) => (
              <Option key={z} label={friendlyZone(z)} selected={z === value} onPick={() => pick(z)} />
            ))}
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
