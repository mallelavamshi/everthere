import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { REASONS, type Reason } from '@everthere/shared';
import type { AssetKey } from '../../assets/manifest';
import { Avatar, Button, Illustration, Sheet } from '../../ui';

const ORDER: Reason[] = ['missing_parent', 'upset_nap', 'new_nervous', 'boo_boo'];
// The reason codes and the sticker keys were named separately.
const STICKER: Record<Reason, AssetKey> = {
  missing_parent: 'reason.missing_parent',
  upset_nap: 'reason.upset_at_nap',
  new_nervous: 'reason.new_and_nervous',
  boo_boo: 'reason.boo_boo',
};

/** Mockup 6: one tap on what is going on, then call the parent's avatar. The reason sets how the avatar opens. */
export function ReasonSheet({
  open,
  onClose,
  childName,
  photoUrl,
  parentTitle,
  onCall,
}: {
  open: boolean;
  onClose: () => void;
  childName: string;
  photoUrl?: string;
  parentTitle: string;
  onCall: (reason: Reason) => void;
}) {
  const [reason, setReason] = useState<Reason>('missing_parent');
  useEffect(() => {
    if (open) setReason('missing_parent');
  }, [open]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`What's going on with ${childName}?`}
      footer={
        <Button size="lg" variant="coral" fullWidth haptic onClick={() => onCall(reason)}>
          {`💛 Call ${parentTitle}'s avatar`}
        </Button>
      }
    >
      <div className="flex items-center gap-3 pb-3">
        <Avatar src={photoUrl} size={48} ring />
        <p className="text-[14px] leading-snug text-mutedText">This helps {parentTitle}&apos;s avatar say the right thing</p>
      </div>
      <div role="group" aria-label="Reason" className="grid grid-cols-2 gap-3">
        {ORDER.map((r) => {
          const on = r === reason;
          return (
            <button
              key={r}
              type="button"
              aria-pressed={on}
              onClick={() => setReason(r)}
              className={clsx(
                'flex min-h-[88px] flex-col items-center justify-center gap-1 rounded-btn border-btn border-ink px-2 py-2 text-[15px] font-semibold leading-tight shadow-chunky transition-colors active:translate-y-[3px] active:shadow-none',
                on ? 'bg-sun' : 'bg-white',
              )}
            >
              <Illustration asset={STICKER[r]} size={44} />
              <span>{REASONS[r].label(parentTitle)}</span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
