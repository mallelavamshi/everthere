import type { ReadyAvatarView } from '@everthere/shared';
import { Avatar, Button, Sheet } from '../../ui';

/** Shown when a child has two ready avatars ("Call Mommy" / "Call Daddy"). One avatar skips this and goes to the reasons. */
export function AvatarPicker({
  open,
  onClose,
  childName,
  photoUrl,
  avatars,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  childName: string;
  photoUrl?: string;
  avatars: ReadyAvatarView[];
  onPick: (a: ReadyAvatarView) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={`Who should ${childName} talk to?`}>
      <div className="flex flex-col items-center gap-4 pb-2 pt-1">
        <Avatar src={photoUrl} size={64} ring />
        <div className="grid w-full grid-cols-1 gap-3 min-[480px]:grid-cols-2">
          {avatars.map((a) => (
            <Button key={a.avatarId} size="lg" variant="sun" fullWidth haptic aria-label={`Call ${a.parentTitle}`} onClick={() => onPick(a)}>
              <span aria-hidden="true">💛 Call {a.parentTitle}</span>
            </Button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
