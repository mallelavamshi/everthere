import { useState } from 'react';
import type { ClassroomView } from '@everthere/shared';
import { useEnrollments, useOrgClassrooms, useOrgStaff } from '../../lib/queries';
import { Button, Card, EmptyState, ErrorState, Skeleton } from '../../ui';
import { AdminScreen } from './AdminScreen';
import { ClassroomEdit } from './ClassroomEdit';
import { plural } from './copy';
import { Emblem } from './Emblem';
import { useAdminOrg } from './useAdminOrg';

/** Classrooms tab: an emblem card per room (name, teachers, children). Tap one to edit; "New classroom" creates. */
export function Classrooms() {
  const { orgId } = useAdminOrg();
  const rooms = useOrgClassrooms(orgId);
  const staff = useOrgStaff(orgId);
  const enrollments = useEnrollments(orgId);
  // Each opening gets its own key so the sheet starts from the classroom it was opened for.
  const [sheet, setSheet] = useState<{ key: number; room: ClassroomView | null } | null>(null);
  const [open, setOpen] = useState(false);
  const show = (room: ClassroomView | null) => {
    setSheet((s) => ({ key: (s?.key ?? 0) + 1, room }));
    setOpen(true);
  };

  const list = rooms.data ?? [];
  const kids = (id: string) => (enrollments.data ?? []).filter((e) => e.classroomId === id);

  return (
    <AdminScreen
      tab="classrooms"
      title="Classrooms"
      actions={
        orgId ? (
          <Button size="sm" variant="sun" onClick={() => show(null)}>
            New classroom
          </Button>
        ) : null
      }
    >
      {rooms.isPending ? (
        <Skeleton shape="card" count={4} />
      ) : rooms.isError ? (
        <ErrorState onRetry={() => void rooms.refetch()} retrying={rooms.isFetching} />
      ) : list.length === 0 ? (
        <EmptyState
          asset="empty.rosterEmpty"
          title="No classrooms yet"
          body="Make your first room, then add teachers and children."
          action={{ label: 'New classroom', onClick: () => show(null) }}
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 min-[600px]:grid-cols-3 min-[900px]:grid-cols-4">
          {list.map((c) => (
            <li key={c.id} className="contents">
              <Card
                tone="white"
                lift
                onClick={() => show(c)}
                aria-label={`${c.name}, ${plural(c.staffUserIds.length, 'teacher')}`}
                className="flex min-h-[168px] flex-col items-center justify-center gap-1.5 px-2 py-4 text-center"
              >
                <Emblem assetKey={c.assetKey} emoji={c.emoji} size={72} />
                <span className="max-w-full truncate text-[18px] font-semibold leading-tight">{c.name}</span>
                <span className="text-[13px] text-mutedText">{c.staffUserIds.length === 0 ? 'No teachers yet' : plural(c.staffUserIds.length, 'teacher')}</span>
                <span className="text-[12px] text-mutedText">{plural(kids(c.id).length, 'child', 'children')}</span>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {orgId && sheet ? (
        <ClassroomEdit
          key={sheet.key}
          open={open}
          onClose={() => setOpen(false)}
          orgId={orgId}
          classroom={sheet.room}
          staff={staff.data ?? []}
          takenAssetKeys={list.map((c) => c.assetKey ?? '')}
          childNames={sheet.room ? kids(sheet.room.id).map((e) => e.childName) : []}
        />
      ) : null}
    </AdminScreen>
  );
}
