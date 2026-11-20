import { Avatar, Button } from '../../ui';

/** An accessible on/off switch with a 44px hit area. The label lives outside, tied by aria-labelledby. */
export function Switch({ checked, onChange, labelledBy, disabled }: { checked: boolean; onChange: (next: boolean) => void; labelledBy: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="grid h-11 w-16 shrink-0 place-items-center disabled:opacity-50"
    >
      <span className={`flex h-8 w-14 items-center rounded-full border-2 border-ink px-0.5 transition-colors ${checked ? 'justify-end bg-mint' : 'justify-start bg-track'}`}>
        <span className="h-6 w-6 rounded-full border-2 border-ink bg-white" />
      </span>
    </button>
  );
}

export interface CaregiverRowProps {
  caregiverId: string;
  name: string;
  transcriptAccess: boolean;
  onToggle: (next: boolean) => void;
  /** Demo accounts are view-only; also set while this row's own save is in flight. */
  disabled?: boolean;
  /** Omitted for demo users, who cannot remove anyone. */
  onRemove?: () => void;
}

export function CaregiverRow({ caregiverId, name, transcriptAccess, onToggle, onRemove, disabled }: CaregiverRowProps) {
  const labelId = `cg-${caregiverId}-label`;
  return (
    <li className="flex flex-col gap-1 rounded-card border-card border-line bg-white p-3">
      <div className="flex items-center gap-3">
        <Avatar name={name} size={44} />
        <p className="min-w-0 flex-1 truncate text-[17px] font-semibold text-ink">{name}</p>
        {onRemove ? (
          <Button variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove ${name}`}>
            Remove
          </Button>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span id={labelId} className="text-[15px] text-ink">
          Can read full conversations
        </span>
        <Switch checked={transcriptAccess} onChange={onToggle} labelledBy={labelId} disabled={disabled} />
      </div>
    </li>
  );
}
