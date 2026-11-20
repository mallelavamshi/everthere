import { useState } from 'react';
import { LIMITS, type EnrollmentView, type RosterTile } from '@everthere/shared';
import { useEnrollments, useOrgClassrooms, useRoster } from '../../lib/queries';
import { Avatar, Badge, Button, EmptyState, ErrorState, Skeleton, type BadgeTone } from '../../ui';
import { AdminScreen } from './AdminScreen';
import { EnrollSheet, type EnrollSheetProps } from './EnrollSheet';
import { useAdminOrg } from './useAdminOrg';

type Stage = RosterTile['status'];

/** Roster readiness is the source of truth (it knows about approved avatars); the enrollment's own status is the fallback. */
const CHIP: Record<Stage, { text: string; tone: BadgeTone }> = {
  invite_sent: { text: 'Invite sent', tone: 'neutral' },
  setup_pending: { text: 'Linked', tone: 'sky' },
  ready: { text: 'Avatar ready', tone: 'mint' },
};

export const stageOf = (e: EnrollmentView, tiles: Map<string, RosterTile>): Stage =>
  tiles.get(e.id)?.status ?? (e.status === 'linked' ? 'setup_pending' : 'invite_sent');

/** An invite code lives LIMITS.inviteTtlMs from the moment the enrollment was made. */
export const inviteLive = (e: EnrollmentView, now = Date.now()) => e.status === 'invited' && e.createdAt + LIMITS.inviteTtlMs > now;

type Opening = { key: number } & Pick<EnrollSheetProps, 'prefill' | 'existing'>;

/** Enrollments tab: every child with a status chip, re-share for live invites, and "Enroll a child". */
export function Enrollments() {
  const { orgId, orgName } = useAdminOrg();
  const enrollments = useEnrollments(orgId);
  const rooms = useOrgClassrooms(orgId);
  const roster = useRoster(orgId);
  const [sheet, setSheet] = useState<Opening | null>(null);
  const [open, setOpen] = useState(false);
  const show = (o: Pick<Opening, 'prefill' | 'existing'> = {}) => {
    setSheet((s) => ({ key: (s?.key ?? 0) + 1, ...o }));
    setOpen(true);
  };

  const tiles = new Map((roster.data ?? []).map((t) => [t.enrollmentId, t]));
  const roomName = (id: string) => rooms.data?.find((c) => c.id === id)?.name ?? '';
  // Newest first.
  const list = [...(enrollments.data ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  const now = Date.now();

  return (
    <AdminScreen
      tab="enrollments"
      title="Enrollments"
      actions={
        orgId ? (
          <Button size="sm" variant="sun" onClick={() => show()}>
            Enroll a child
          </Button>
        ) : null
      }
    >
      {enrollments.isPending ? (
        <Skeleton shape="card" count={4} />
      ) : enrollments.isError ? (
        <ErrorState onRetry={() => void enrollments.refetch()} retrying={enrollments.isFetching} />
      ) : list.length === 0 ? (
        <EmptyState
          asset="empty.noChildren"
          title="No children enrolled yet"
          body="Add a child and send their family a code. Their avatar shows up here once it is ready."
          action={{ label: 'Enroll a child', onClick: () => show() }}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-2 min-[900px]:grid-cols-2">
          {list.map((e) => {
            const stage = stageOf(e, tiles);
            const chip = CHIP[stage];
            const live = inviteLive(e, now);
            const waiting = stage === 'invite_sent';
            return (
              <li key={e.id} aria-label={e.childName} className="flex items-center gap-3 rounded-card border-card border-line bg-white p-3">
                <Avatar src={tiles.get(e.id)?.photoUrl} name={e.childName} size={48} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[17px] font-semibold leading-tight">{e.childName}</p>
                  <p className="truncate text-[13px] text-mutedText">{roomName(e.classroomId)}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone={chip.tone}>{chip.text}</Badge>
                    {waiting && !live ? <span className="text-[12px] text-mutedText">Invite expired</span> : null}
                  </div>
                </div>
                {waiting ? (
                  live ? (
                    <Button
                      size="sm"
                      variant="white"
                      aria-label={`Share invite for ${e.childName}`}
                      onClick={() => show({ existing: { code: e.inviteCode, childName: e.childName, expiresAt: e.createdAt + LIMITS.inviteTtlMs } })}
                    >
                      Share invite
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="white"
                      aria-label={`Create a new invite for ${e.childName}`}
                      onClick={() => show({ prefill: { childName: e.childName, classroomId: e.classroomId } })}
                    >
                      Create a new invite
                    </Button>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {orgId && sheet ? (
        <EnrollSheet
          key={sheet.key}
          open={open}
          onClose={() => setOpen(false)}
          orgId={orgId}
          orgName={orgName}
          classrooms={rooms.data ?? []}
          prefill={sheet.prefill}
          existing={sheet.existing}
        />
      ) : null}
    </AdminScreen>
  );
}
