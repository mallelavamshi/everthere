import { useRef, useState } from 'react';
import { useSelectedChild } from '../../lib/selectedChild';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CaregiversView, ChildView } from '@everthere/shared';
import { api, ApiError, friendlyMessage } from '../../lib/api';
import { haptics } from '../../lib/native';
import { qk, useCaregivers, useChildren } from '../../lib/queries';
import { useSession } from '../../shell/SessionContext';
import { Avatar, Button, Card, Chip, EmptyState, ErrorState, Sheet, Skeleton, toast } from '../../ui';
import { ParentScreen } from '../parent/ParentScreen';
import { CaregiverRow, Switch } from './CaregiverRow';
import { InviteSheet, type InviteVariant } from './InviteSheet';

const MAX_TEACHERS = 5;
const NANNY_CTA = 'Invite a nanny or grandparent 👵';
const COPARENT_CTA = 'Invite co-parent 💑';

interface Target {
  id: string;
  name: string;
}

export function CaregiversTab() {
  const children = useChildren();
  const [pick, setPick] = useSelectedChild();
  const list = children.data ?? [];
  const focus = list.find((c) => c.id === pick) ?? list[0];

  return (
    <ParentScreen tab="caregivers" title="Caregivers">
      {children.isPending ? (
        <Skeleton shape="card" count={2} />
      ) : children.isError ? (
        <ErrorState onRetry={() => void children.refetch()} retrying={children.isFetching} />
      ) : !focus ? (
        <NoChildren />
      ) : (
        <div className="flex flex-col gap-3 pt-1">
          {list.length > 1 ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a child">
              {list.map((c) => (
                <Chip
                  key={c.id}
                  selected={c.id === focus.id}
                  icon={<Avatar src={c.photoUrl} emoji={c.photoUrl ? undefined : c.name.charAt(0).toUpperCase()} size={24} />}
                  onClick={() => setPick(c.id)}
                >
                  {c.name}
                </Chip>
              ))}
            </div>
          ) : null}
          <ChildCaregivers key={focus.id} child={focus} siblings={list.filter((c) => c.familyId === focus.familyId)} />
        </div>
      )}
    </ParentScreen>
  );
}

function NoChildren() {
  const navigate = useNavigate();
  return (
    <EmptyState
      asset="empty.noChildren"
      title="Add your little one first"
      body="Once you add your child you can invite grandparents, nannies and a co-parent."
      action={{ label: 'Add your child', onClick: () => navigate('/parent/children/new') }}
    />
  );
}

function ChildCaregivers({ child, siblings }: { child: ChildView; siblings: ChildView[] }) {
  const { me } = useSession();
  const qc = useQueryClient();
  const cg = useCaregivers(child.id);
  const [invite, setInvite] = useState<InviteVariant | null>(null);
  const [removing, setRemoving] = useState<Target | null>(null);
  const lastRemoved = useRef('');
  if (removing) lastRemoved.current = removing.name;
  const removedName = removing?.name ?? lastRemoved.current;
  const demo = me.user.isDemo;
  const key = qk.caregivers(child.id);
  const base = `/children/${encodeURIComponent(child.id)}/caregivers`;

  const toggle = useMutation({
    mutationFn: ({ connectionId, next }: { connectionId: string; next: boolean }) =>
      api(`${base}/${encodeURIComponent(connectionId)}`, { method: 'PATCH', json: { transcriptAccess: next } }),
    onMutate: async ({ connectionId, next }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<CaregiversView>(key);
      if (prev) {
        qc.setQueryData<CaregiversView>(key, {
          ...prev,
          daycare: prev.daycare && prev.daycare.connectionId === connectionId ? { ...prev.daycare, transcriptAccess: next } : prev.daycare,
          home: prev.home.map((h) => (h.connectionId === connectionId ? { ...h, transcriptAccess: next } : h)),
        });
      }
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      haptics.error();
      toast.error(e instanceof ApiError && e.code === 'DEMO_READ_ONLY' ? friendlyMessage(e.code) : "We couldn't save that change. Please try again.");
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  });

  const remove = useMutation({
    mutationFn: (connectionId: string) => api(`${base}/${encodeURIComponent(connectionId)}`, { method: 'DELETE' }),
    onSuccess: () => {
      setRemoving(null);
      haptics.success();
      toast.success('Removed');
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => {
      haptics.error();
      toast.error(e instanceof ApiError ? friendlyMessage(e.code) : "We couldn't remove them. Please try again.");
    },
  });

  if (cg.isPending) return <Skeleton shape="card" count={3} />;
  if (cg.isError) return <ErrorState onRetry={() => void cg.refetch()} retrying={cg.isFetching} />;

  const { daycare, home } = cg.data;
  const sheets = (
    <>
      <InviteSheet open={invite !== null} onClose={() => setInvite(null)} variant={invite ?? 'home_caregiver'} kids={siblings} focusChild={child} />
      <Sheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Remove ${removedName}?`}
        footer={
          <div className="flex flex-col gap-2">
            <Button fullWidth variant="coral" loading={remove.isPending} onClick={() => removing && remove.mutate(removing.id)}>
              Remove {removedName}
            </Button>
            <Button fullWidth variant="ghost" onClick={() => setRemoving(null)}>
              Keep them
            </Button>
          </div>
        }
      >
        <p className="py-2 text-[16px] leading-relaxed text-ink">
          {removedName} won&apos;t be able to start comfort calls for {child.name} anymore.
        </p>
      </Sheet>
    </>
  );

  if (!daycare && home.length === 0) {
    return (
      <>
        <EmptyState
          asset="empty.noCaregivers"
          title="Your village, all in one place"
          body={`Grandparents, nannies and daycare teachers you trust will show up here, so your avatar can be there wherever ${child.name} is.`}
          action={
            <div className="flex flex-col gap-2">
              <Button onClick={() => setInvite('home_caregiver')}>{NANNY_CTA}</Button>
              <Button variant="white" onClick={() => setInvite('co_parent')}>{COPARENT_CTA}</Button>
            </div>
          }
        />
        {sheets}
      </>
    );
  }

  const shown = daycare?.teachers.slice(0, MAX_TEACHERS) ?? [];
  const extra = (daycare?.teachers.length ?? 0) - shown.length;
  return (
    <>
      {demo ? <p className="text-center text-[13px] text-mutedText">Demo account — view only</p> : null}
      {daycare ? (
        <Card tone="sky" className="flex flex-col gap-3 p-4" aria-label="Daycare">
          <div className="flex items-center gap-3">
            <Avatar name={daycare.org.name} size={48} ring />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[18px] font-semibold text-ink">{daycare.org.name}</p>
              <p className="text-[13px] text-mutedText">{child.name}&apos;s daycare</p>
            </div>
          </div>
          {shown.length ? (
            <div className="flex items-center">
              {shown.map((t, i) => (
                <span key={t.userId} className={i ? '-ml-2' : ''}>
                  <Avatar name={t.name} size={36} />
                </span>
              ))}
              {extra > 0 ? <span className="ml-2 text-[14px] font-semibold text-ink">+{extra}</span> : null}
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p id="daycare-access" className="text-[15px] font-semibold text-ink">
                Daycare can read full conversations
              </p>
              <p className="text-[13px] text-mutedText">Teachers always see summaries and flags</p>
            </div>
            <Switch
              checked={daycare.transcriptAccess}
              labelledBy="daycare-access"
              disabled={demo || (toggle.isPending && toggle.variables?.connectionId === daycare.connectionId)}
              onChange={(next) => toggle.mutate({ connectionId: daycare.connectionId, next })}
            />
          </div>
        </Card>
      ) : null}

      {home.length ? (
        <>
          <h2 className="mt-1 text-[18px] font-semibold text-ink">At home</h2>
          <ul className="flex flex-col gap-2">
            {home.map((h) => (
              <CaregiverRow
                key={h.connectionId}
                caregiverId={h.connectionId}
                name={h.name}
                transcriptAccess={h.transcriptAccess}
                onToggle={(next) => toggle.mutate({ connectionId: h.connectionId, next })}
                disabled={demo || (toggle.isPending && toggle.variables?.connectionId === h.connectionId)}
                onRemove={demo ? undefined : () => setRemoving({ id: h.connectionId, name: h.name })}
              />
            ))}
          </ul>
        </>
      ) : null}

      <div className="flex flex-col gap-2 pt-2">
        <Button fullWidth onClick={() => setInvite('home_caregiver')}>{NANNY_CTA}</Button>
        <Button fullWidth variant="white" onClick={() => setInvite('co_parent')}>{COPARENT_CTA}</Button>
      </div>
      {sheets}
    </>
  );
}
