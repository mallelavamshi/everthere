import { useEffect, useMemo, useState } from 'react';
import { useSelectedChild } from '../../lib/selectedChild';
import { useNavigate } from 'react-router-dom';
import { motion as fm } from 'framer-motion';
import type { AvatarView, ChildView, FamilyAvatarView } from '@everthere/shared';
import { ApiError, friendlyMessage } from '../../lib/api';
import { useAvatar, useChildren, usePlan, useSessions } from '../../lib/queries';
import { motion } from '../../theme/motion';
import { Badge, Button, Card, Chip, EmptyState, ErrorState, Illustration, Skeleton, Avatar, type BadgeTone } from '../../ui';
import { useSession } from '../../shell/SessionContext';
import { ageLabel } from '../onboarding/lib';
import { AvatarNudge, continuePath } from './CreateAvatarCard';
import { greetingFor } from './greeting';
import { ParentScreen } from './ParentScreen';
import { SessionCard } from '../sessions/SessionCard';
import { TodayNoteSheet } from '../plan/TodayNoteSheet';

const STATUS: Record<string, { tone: BadgeTone; text: (who: string) => string }> = {
  approved: { tone: 'mint', text: () => '✨ Your avatar is ready' },
  ready: { tone: 'sun', text: () => '🎥 Test and approve it' },
  creating: { tone: 'sky', text: () => '🪄 Your avatar is being made' },
  failed: { tone: 'flag', text: () => '📸 Needs a new photo' },
};

/** One badge per avatar on the family: the signed-in parent's own, plus one for each co-parent's. */
function AvatarPills({ avatars, coParents }: { avatars: AvatarView[]; coParents: FamilyAvatarView[] }) {
  if (!avatars.length && !coParents.length) return <Badge tone="neutral">🪞 No avatar yet</Badge>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {avatars.map((a) => {
        const s = STATUS[a.status] ?? STATUS.creating!;
        return (
          <Badge key={a.id} tone={s.tone}>
            {avatars.length > 1 ? `${a.parentTitle}: ` : ''}
            {s.text(a.parentTitle)}
          </Badge>
        );
      })}
      {coParents.map((a) => {
        const who = a.parentTitle || a.ownerName;
        return a.status === 'approved' ? (
          <Badge key={a.avatarId} tone="mint">
            ✨ {who} is ready
          </Badge>
        ) : (
          <Badge key={a.avatarId} tone="sky">
            ⏳ {who} is setting up
          </Badge>
        );
      })}
    </div>
  );
}

function ChildCard({ child, avatars, onEdit, onPlan }: { child: ChildView; avatars: AvatarView[]; onEdit?: () => void; onPlan?: () => void }) {
  const age = child.birthday ? ageLabel(child.birthday) : null;
  return (
    <Card tone="white" lift={false} className="!p-4">
      <div className="flex items-center gap-3">
        <Avatar src={child.photoUrl} emoji="🧸" name={child.name} size={60} ring />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="truncate text-[20px] font-semibold leading-tight">{child.name}</h2>
          {age ? <span className="text-[13px] text-mutedText">{age}</span> : null}
          <AvatarPills avatars={avatars} coParents={(child.familyAvatars ?? []).filter((a) => !a.isMine)} />
        </div>
        {onEdit ? (
          <button type="button" aria-label={`Edit ${child.name}`} onClick={onEdit} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[20px] active:bg-ink/10">
            <span aria-hidden="true">✏️</span>
          </button>
        ) : null}
      </div>
      {onPlan ? (
        <button
          type="button"
          aria-label={`${child.name}'s comfort plan`}
          onClick={onPlan}
          className="mt-3 flex min-h-[44px] w-full items-center justify-between rounded-full border-2 border-ink bg-cream px-4 text-[15px] font-semibold active:bg-sun/40"
        >
          <span>
            <span aria-hidden="true">💛 </span>Comfort plan
          </span>
          <span aria-hidden="true">›</span>
        </button>
      ) : null}
    </Card>
  );
}

/** Mockup 1: greeting, child cards with avatar status, today's note, the latest session. */
export function ParentHome({ now }: { now?: Date } = {}) {
  const navigate = useNavigate();
  const { me } = useSession();
  const demo = me.user.isDemo;
  const children = useChildren();
  const avatars = useAvatar();
  const [pick, setPick] = useSelectedChild();
  const [noteOpen, setNoteOpen] = useState(false);

  const list = children.data ?? [];
  const focus = list.find((c) => c.id === pick) ?? list[0];
  const mine = avatars.data ?? [];
  const best = mine.find((a) => a.status === 'approved') ?? mine[0];
  const plan = usePlan(focus?.id, best?.id);
  const sessions = useSessions(focus?.id);
  const latest = sessions.data?.pages[0]?.items[0];
  const greeting = useMemo(() => greetingFor(now ?? new Date(), me.user.name), [now, me.user.name]);

  // Keep the selected child valid if the list changes underneath us.
  useEffect(() => {
    if (pick && list.length && !list.some((c) => c.id === pick)) setPick(null);
  }, [pick, list]);

  if (children.isError || avatars.isError) {
    const err = (children.error ?? avatars.error) as unknown;
    return (
      <ParentScreen tab="home" bg="sunGradient">
        <ErrorState
          offline={err instanceof ApiError && err.code === 'NETWORK'}
          body={err instanceof ApiError ? friendlyMessage(err.code) : undefined}
          onRetry={() => {
            void children.refetch();
            void avatars.refetch();
          }}
          retrying={children.isFetching || avatars.isFetching}
        />
      </ParentScreen>
    );
  }
  if (children.isPending || avatars.isPending) {
    return (
      <ParentScreen tab="home" bg="sunGradient">
        <div className="flex flex-col gap-4 pt-2">
          <Skeleton shape="line" width={220} height={28} />
          <Skeleton shape="card" height={104} />
          <Skeleton shape="card" />
        </div>
      </ParentScreen>
    );
  }

  const nudge = avatars.data && (mine.length === 0 || mine[0]!.status !== 'approved') ? mine[0] : undefined;
  const showNudge = !demo && (mine.length === 0 || mine[0]!.status !== 'approved');

  return (
    <ParentScreen tab="home" bg="sunGradient">
      <fm.div variants={motion.stagger.container} initial="hidden" animate="show" className="flex flex-col gap-4 pt-2">
        <fm.header variants={motion.stagger.item}>
          <h1 className="text-[26px] font-semibold leading-tight">{greeting}</h1>
          <p className="mt-0.5 text-[15px] text-mutedText">{focus ? `Here's how things look for ${focus.name}` : "Let's get your little one set up"}</p>
        </fm.header>

        {showNudge && list.length > 0 ? (
          <fm.div variants={motion.stagger.item}>
            <AvatarNudge avatar={nudge} onCreate={() => navigate('/parent/avatar/setup')} onContinue={(a) => navigate(continuePath(a))} />
          </fm.div>
        ) : null}

        {list.length === 0 ? (
          <fm.div variants={motion.stagger.item}>
            <EmptyState
              asset="empty.noChildren"
              title="Who are we comforting?"
              body="Add your little one and we'll get your avatar ready for them."
              action={{ label: 'Add your child', onClick: () => navigate('/parent/children/new') }}
            />
          </fm.div>
        ) : (
          <>
            {list.length > 1 ? (
              <fm.div variants={motion.stagger.item} className="flex flex-wrap gap-2" role="group" aria-label="Choose a child">
                {list.map((c) => (
                  <Chip key={c.id} selected={c.id === focus?.id} onClick={() => setPick(c.id)}>
                    {c.name}
                  </Chip>
                ))}
              </fm.div>
            ) : null}
            {list.map((c) => (
              <fm.div key={c.id} variants={motion.stagger.item}>
                <ChildCard
                  child={c}
                  avatars={mine}
                  onEdit={demo ? undefined : () => navigate(`/parent/children/${c.id}`)}
                  onPlan={best ? () => navigate(`/parent/children/${c.id}/plan/${best.id}`) : undefined}
                />
              </fm.div>
            ))}

            {focus ? (
              <fm.div variants={motion.stagger.item}>
                <Card tone="sun" onClick={() => setNoteOpen(true)} aria-label={plan.data?.todayNote ? `Today's note: ${plan.data.todayNote}` : 'Add a note for today'}>
                  <div className="flex items-center gap-3">
                    <span aria-hidden="true" className="text-[24px]">
                      📌
                    </span>
                    <p className="flex-1 text-[16px] leading-snug">
                      {plan.data?.todayNote ? (
                        <>
                          <b>Today:</b> {plan.data.todayNote}
                        </>
                      ) : (
                        <>
                          <b>Add a note for today</b>
                          <span className="block text-[14px]">Like who is picking up</span>
                        </>
                      )}
                    </p>
                    <span aria-hidden="true" className="text-[18px]">
                      ›
                    </span>
                  </div>
                </Card>
              </fm.div>
            ) : null}

            {focus ? (
              <fm.section variants={motion.stagger.item} aria-label="Latest comfort call" className="flex flex-col gap-2">
                <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-mutedText">Latest comfort call</h2>
                {sessions.isPending ? (
                  <Skeleton shape="card" />
                ) : latest ? (
                  <SessionCard s={latest} onClick={() => navigate(`/parent/sessions/${encodeURIComponent(latest.id)}`)} />
                ) : (
                  <Card tone="white" className="flex items-center gap-3">
                    <Illustration asset="empty.noSessions" size={64} />
                    <div>
                      <p className="text-[16px] font-semibold">No comfort calls yet</p>
                      <p className="text-[14px] text-mutedText">When {focus.name} has a wobbly moment, the story will show up here 💛</p>
                    </div>
                  </Card>
                )}
              </fm.section>
            ) : null}

            {!demo ? (
              <fm.div variants={motion.stagger.item} className="flex justify-center">
                <Button variant="ghost" icon="＋" onClick={() => navigate('/parent/children/new')}>
                  Add another child
                </Button>
              </fm.div>
            ) : null}
          </>
        )}
      </fm.div>
      {focus ? <TodayNoteSheet
          open={noteOpen}
          onClose={() => setNoteOpen(false)}
          child={focus}
          note={plan.data?.todayNote}
          fallbackAvatarIds={mine.filter((a) => a.status === 'approved' || a.status === 'ready').map((a) => a.id)}
        /> : null}
    </ParentScreen>
  );
}
