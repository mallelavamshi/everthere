import { motion as fm } from 'framer-motion';
import type { AvatarView } from '@everthere/shared';
import { motion } from '../../theme/motion';
import { Card, Illustration } from '../../ui';

/** The inviting card for a parent whose avatar is missing or not finished yet. null when there is nothing to do. */
export function AvatarNudge({ avatar, onCreate, onContinue }: { avatar: AvatarView | undefined; onCreate: () => void; onContinue: (a: AvatarView) => void }) {
  if (!avatar) {
    return (
      <fm.div {...motion.pop}>
        <Card tone="sun" onClick={onCreate} aria-label="Create your avatar" className="relative overflow-hidden !p-5">
          <div className="flex items-center gap-4">
            <Illustration asset="onboarding.avatarPhoto" size={92} priority />
            <div className="flex flex-col gap-1">
              <h2 className="text-[22px] font-semibold leading-tight">Create your avatar</h2>
              <p className="text-[14px] leading-snug">A photo, a voice, and a little magic, so you can be there even when you can't.</p>
              <span className="mt-1 inline-flex min-h-[44px] items-center self-start rounded-full border-2 border-ink bg-white px-4 text-[14px] font-semibold">Let's go ✨</span>
            </div>
          </div>
        </Card>
      </fm.div>
    );
  }
  if (avatar.status === 'approved') return null;
  const copy =
    avatar.status === 'ready'
      ? { title: 'Meet your avatar', body: 'Take a quick test call, then approve it so your little one can use it.', cta: 'Test and approve' }
      : avatar.status === 'failed'
        ? { title: 'Let\'s retake that photo', body: 'The last photo didn\'t work out. A bright, front-facing one usually does.', cta: 'Retake photo' }
        : { title: 'Your avatar is being made ✨', body: 'It takes a minute or two. Tap to check how it\'s going.', cta: 'See progress' };
  return (
    <Card tone="sun" onClick={() => onContinue(avatar)} aria-label={copy.title} className="!p-5">
      <h2 className="text-[20px] font-semibold leading-tight">{copy.title}</h2>
      <p className="mt-1 text-[14px] leading-snug">{copy.body}</p>
      <span className="mt-3 inline-flex min-h-[44px] items-center rounded-full border-2 border-ink bg-white px-4 text-[14px] font-semibold">{copy.cta}</span>
    </Card>
  );
}

/** Where a half-finished avatar continues. */
export const continuePath = (a: AvatarView): string => (a.status === 'ready' ? `/parent/avatar/test/${a.id}` : a.status === 'failed' ? '/parent/avatar/retake' : `/parent/avatar/creating/${a.id}`);
