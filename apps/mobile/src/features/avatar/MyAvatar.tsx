import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AvatarView } from '@everthere/shared';
import { ApiError, friendlyMessage } from '../../lib/api';
import { useAvatar, useChildren } from '../../lib/queries';
import { Avatar, Badge, Button, Card, ErrorState, Sheet, Skeleton, type BadgeTone } from '../../ui';
import { useSession } from '../../shell/SessionContext';
import { AvatarNudge, continuePath } from '../parent/CreateAvatarCard';
import { ParentScreen } from '../parent/ParentScreen';
import { voiceDescriptor, voiceLabel } from './voices';

export const STATUS_BADGE: Record<string, { tone: BadgeTone; text: string }> = {
  approved: { tone: 'mint', text: 'Approved ✓' },
  ready: { tone: 'sun', text: 'Ready to approve' },
  creating: { tone: 'sky', text: 'Being made…' },
  failed: { tone: 'flag', text: 'Needs a new photo' },
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t-2 border-line py-3 first:border-t-0">
      <span className="text-[13px] font-semibold uppercase tracking-[0.06em] text-mutedText">{label}</span>
      <span className="text-right text-[16px] font-medium">{children}</span>
    </div>
  );
}

type Edit = 'photo' | 'voice';

/** The My Avatar tab: status, photo, voice and the edit actions (which warn first, and are hidden in the demo). */
export function MyAvatar() {
  const navigate = useNavigate();
  const { me } = useSession();
  const q = useAvatar();
  const kids = useChildren();
  const [edit, setEdit] = useState<Edit | null>(null);
  const a: AvatarView | undefined = q.data?.[0];
  const demo = me.user.isDemo;

  if (q.isError) {
    return (
      <ParentScreen tab="avatar" title="My Avatar">
        <ErrorState offline={q.error instanceof ApiError && q.error.code === 'NETWORK'} body={q.error instanceof ApiError ? friendlyMessage(q.error.code) : undefined} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      </ParentScreen>
    );
  }
  if (q.isPending) {
    return (
      <ParentScreen tab="avatar" title="My Avatar">
        <div className="flex flex-col items-center gap-4 pt-4">
          <Skeleton shape="circle" width={112} height={112} />
          <Skeleton shape="card" />
        </div>
      </ParentScreen>
    );
  }
  if (!a) {
    return (
      <ParentScreen tab="avatar" title="My Avatar">
        <div className="flex flex-col gap-4 pt-2">
          <AvatarNudge avatar={undefined} onCreate={() => navigate('/parent/avatar/setup')} onContinue={() => {}} />
        </div>
      </ParentScreen>
    );
  }

  const badge = STATUS_BADGE[a.status] ?? { tone: 'neutral' as BadgeTone, text: a.status };
  const primary =
    a.status === 'ready'
      ? { label: 'Test and approve', icon: '🎥' }
      : a.status === 'creating'
        ? { label: 'See progress', icon: '✨' }
        : a.status === 'failed'
          ? { label: 'Retake photo', icon: '📸' }
          : { label: 'Test call', icon: '🎥' };

  const confirm = () => {
    const to = edit === 'photo' ? '/parent/avatar/retake' : '/parent/avatar/voice';
    setEdit(null);
    navigate(to);
  };

  return (
    <ParentScreen tab="avatar" title="My Avatar">
      <div className="flex flex-col gap-4 pt-1">
        <Card tone="mint" className="flex flex-col items-center gap-3 !p-5 text-center">
          <Avatar src={a.photoUrl ?? undefined} emoji={a.photoUrl ? undefined : '🧑'} name={`${a.parentTitle}'s avatar`} size={120} ring />
          <h2 className="text-[22px] font-semibold leading-tight">Your avatar</h2>
          <Badge tone={badge.tone}>{badge.text}</Badge>
        </Card>

        <Card>
          <Row label="Voice">
            {voiceLabel(a.voiceId)}
            <span className="block text-[14px] font-normal text-mutedText">{voiceDescriptor(a.voiceId)}</span>
          </Row>
          <Row label="Called">{a.parentTitle}</Row>
          <Row label="Agreed by">{a.consentName}</Row>
        </Card>

        <Button size="lg" fullWidth haptic icon={primary.icon} onClick={() => navigate(continuePath(a))}>
          {primary.label}
        </Button>

        {kids.data?.length ? (
          <section aria-label="Comfort plans" className="flex flex-col gap-2">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-mutedText">Comfort plans</h2>
            <Card className="!p-0">
              {kids.data.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => navigate(`/parent/children/${c.id}/plan/${a.id}`)}
                  className="flex min-h-[56px] w-full items-center justify-between gap-3 border-t-2 border-line px-4 text-left text-[16px] font-medium first:border-t-0 active:bg-cream"
                >
                  <span className="truncate">
                    <span aria-hidden="true">💛 </span>
                    {c.name}'s comfort plan
                  </span>
                  <span aria-hidden="true" className="text-[18px]">
                    ›
                  </span>
                </button>
              ))}
            </Card>
          </section>
        ) : null}

        {demo ? (
          <p className="rounded-card bg-lilac px-4 py-3 text-center text-[14px] leading-snug">You're in a demo account, so photo and voice changes are switched off. Look around as much as you like 💜</p>
        ) : (
          <div className="flex flex-col gap-3">
            <Button variant="white" fullWidth icon="📸" onClick={() => setEdit('photo')}>
              Change photo
            </Button>
            <Button variant="white" fullWidth icon="🎙️" onClick={() => setEdit('voice')}>
              Change voice
            </Button>
          </div>
        )}
      </div>

      <Sheet
        open={edit !== null}
        onClose={() => setEdit(null)}
        title={edit === 'photo' ? 'Change your photo?' : 'Change your voice?'}
        footer={
          <div className="flex flex-col gap-2">
            <Button size="lg" fullWidth onClick={confirm}>
              Continue
            </Button>
            <Button variant="ghost" fullWidth onClick={() => setEdit(null)}>
              Never mind
            </Button>
          </div>
        }
      >
        <p className="pb-2 text-[16px] leading-relaxed">Changing this means you'll test and approve again.</p>
        {edit === 'photo' ? <p className="pb-2 text-[14px] leading-snug text-mutedText">A new photo also needs your OK again, so we'll ask for your name and consent.</p> : null}
      </Sheet>
    </ParentScreen>
  );
}
