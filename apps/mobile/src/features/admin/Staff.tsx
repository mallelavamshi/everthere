import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { StaffMember } from '@everthere/shared';
import { api, ApiError, friendlyMessage } from '../../lib/api';
import { haptics } from '../../lib/native';
import { qk, useOrgStaff } from '../../lib/queries';
import { Avatar, Badge, Button, EmptyState, ErrorState, Sheet, Skeleton, toast } from '../../ui';
import { InviteSheet } from '../caregivers/InviteSheet';
import { AdminScreen } from './AdminScreen';
import { useAdminOrg } from './useAdminOrg';
import { useSession } from '../../shell/SessionContext';

/** The one INVALID a staff removal can answer with: the person is the daycare's last admin. */
export const LAST_ADMIN_COPY = "Every daycare needs at least one admin, so we can't remove the last one. Ask another admin to do it 💛";

function Row({ m, you, onRemove }: { m: StaffMember; you: boolean; onRemove?: () => void }) {
  const label = m.name || m.email || 'Unnamed';
  return (
    <li aria-label={label} className="flex items-center gap-3 rounded-card border-card border-line bg-white p-3">
      <Avatar name={label} size={48} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[17px] font-semibold leading-tight">{label}</span>
          {you ? <span className="text-[12px] text-mutedText">(you)</span> : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge tone={m.role === 'admin' ? 'sun' : 'sky'}>{m.role === 'admin' ? 'Admin' : 'Teacher'}</Badge>
          <Badge tone={m.hasPin ? 'mint' : 'neutral'}>{m.hasPin ? 'PIN set ✓' : 'No PIN yet'}</Badge>
        </div>
      </div>
      {onRemove ? (
        <Button size="sm" variant="ghost" aria-label={`Remove ${label}`} onClick={onRemove}>
          Remove
        </Button>
      ) : null}
    </li>
  );
}

/** Staff tab: everyone in the daycare with PIN status, an invite for new teachers, and a confirmed remove. */
export function Staff() {
  const { me } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { orgId, orgName, isDemo } = useAdminOrg();
  const staff = useOrgStaff(orgId);
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<StaffMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const lastRemoved = useRef<StaffMember | null>(null);
  if (removing) lastRemoved.current = removing;
  const shown = removing ?? lastRemoved.current;
  const shownIsMe = shown?.userId === me.user.id;
  const shownName = shown ? shown.name || shown.email || 'this person' : '';

  const close = () => {
    if (busy) return;
    setRemoving(null);
    setError(null);
  };

  const remove = async () => {
    if (!removing || !orgId || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const target = removing;
    try {
      await api(`/orgs/${encodeURIComponent(orgId)}/staff/${encodeURIComponent(target.userId)}`, { method: 'DELETE' });
      haptics.success();
      toast.success(`${target.name || 'They'} ${target.name ? 'was' : 'were'} removed`);
      setRemoving(null);
      void qc.invalidateQueries({ queryKey: qk.orgStaff(orgId) });
      void qc.invalidateQueries({ queryKey: qk.orgClassrooms(orgId) });
      if (target.userId === me.user.id) {
        // They are no longer an admin here: reload who they are, then leave through "/" (which picks their new home)
        // rather than sit on screens that would now answer FORBIDDEN.
        await qc.invalidateQueries({ queryKey: qk.me(), refetchType: 'all' }).catch(() => undefined);
        navigate('/', { replace: true });
      }
    } catch (e) {
      haptics.error();
      const code = e instanceof ApiError ? e.code : 'INTERNAL';
      setError(code === 'INVALID' ? LAST_ADMIN_COPY : friendlyMessage(code));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const list = staff.data ?? [];
  return (
    <AdminScreen
      tab="staff"
      title="Staff"
      actions={
        <Button size="sm" variant="sun" onClick={() => setInviting(true)}>
          Invite a teacher
        </Button>
      }
    >
      {isDemo ? <p className="mb-3 rounded-card bg-lilac px-4 py-2 text-[14px]">View only: the demo account can look around, but can’t remove staff.</p> : null}
      {staff.isPending ? (
        <Skeleton shape="card" count={3} />
      ) : staff.isError ? (
        <ErrorState onRetry={() => void staff.refetch()} retrying={staff.isFetching} />
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-2 min-[900px]:grid-cols-2">
            {list.map((m) => (
              <Row key={m.userId} m={m} you={m.userId === me.user.id} onRemove={isDemo ? undefined : () => setRemoving(m)} />
            ))}
          </ul>
          {list.length <= 1 ? (
            <EmptyState
              asset="empty.noStaff"
              title="Your team starts here"
              body="Invite a teacher and they can use the classroom tablet."
              action={{ label: 'Invite a teacher', onClick: () => setInviting(true) }}
            />
          ) : null}
        </>
      )}

      <InviteSheet open={inviting} onClose={() => setInviting(false)} variant="staff" orgId={orgId} orgName={orgName} />

      <Sheet
        open={!!removing}
        onClose={close}
        title={shownIsMe ? 'Remove yourself?' : `Remove ${shownName}?`}
        footer={
          <div className="flex gap-2">
            <Button fullWidth variant="white" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button fullWidth variant="coral" loading={busy} onClick={() => void remove()}>
              Remove
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 py-2">
          <p className="text-[15px]">
            {shownIsMe
              ? `You'll lose admin access to ${orgName}. Are you sure?`
              : `${shownName} will lose access to this daycare and their PIN will be cleared.`}
          </p>
          {error ? (
            <p role="alert" className="rounded-card bg-flag p-3 text-[14px]">
              {error}
            </p>
          ) : null}
        </div>
      </Sheet>
    </AdminScreen>
  );
}
