import type { ReadyAvatarView } from '@everthere/shared';
import { Avatar, Button, Sheet } from '../../ui';

/**
 * Shown when a child has two ready avatars ("Call Mommy" / "Call Daddy"). One avatar skips this and goes to the reasons.
 * Each option shows that parent's own face (falling back to the child's photo if the link fails); when no parent has a
 * photo, the child's photo stays on top as before.
 */
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
  const faces = avatars.some((a) => a.photoUrl);
  return (
    <Sheet open={open} onClose={onClose} title={`Who should ${childName} talk to?`}>
      <div className="flex flex-col items-center gap-4 pb-2 pt-1">
        {faces ? null : <Avatar src={photoUrl} size={64} ring />}
        <div className="grid w-full grid-cols-1 gap-3 min-[480px]:grid-cols-2">
          {avatars.map((a) => (
            <Button
              key={a.avatarId}
              size="lg"
              variant="sun"
              fullWidth
              haptic
              aria-label={`Call ${a.parentTitle}`}
              onClick={() => onPick(a)}
              className={faces ? '!py-3' : undefined}
            >
              {faces ? (
                <span className="flex flex-col items-center gap-2">
                  <Avatar src={a.photoUrl} fallbackSrc={photoUrl} size={72} ring />
                  <span aria-hidden="true">💛 Call {a.parentTitle}</span>
                </span>
              ) : (
                <span aria-hidden="true">💛 Call {a.parentTitle}</span>
              )}
            </Button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
