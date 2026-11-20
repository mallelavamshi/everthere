import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import type { Reason, ReadyAvatarView } from '@everthere/shared';
import { img, type AssetKey } from '../../assets/manifest';
import { ApiError, friendlyMessage } from '../../lib/api';
import { useKeepAwake } from '../../live/keepAwake';
import { qk, useCaregiverChildren, useMyClassrooms, useRoster, useStaffSwitch } from '../../lib/queries';
import { clearActingToken } from '../../lib/storage';
import { useSession } from '../../shell/SessionContext';
import { Avatar, EmptyState, ErrorState, Illustration, Screen, Skeleton, toast } from '../../ui';
import { useProfileTrigger } from '../../ui/profileContext';
import { usePullToRefresh } from '../sessions/usePullToRefresh';
import { AvatarPicker } from './AvatarPicker';
import { ChildTile, whyNot, type TileModel } from './ChildTile';
import { rememberCall } from './pendingCall';
import { ReasonSheet } from './ReasonSheet';
import { SwitchTeacher } from './SwitchTeacher';
import { switchPrompt } from '../../lib/switchPrompt';
import { useActing } from './useActing';

const todayLabel = () => new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());

const isAsset = (k: string | null | undefined): k is AssetKey => !!k && k in img;

function Emblem({ assetKey, emoji, size }: { assetKey: string | null; emoji: string | null; size: number }) {
  if (isAsset(assetKey)) return <Illustration asset={assetKey} size={size} priority />;
  return (
    <span aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.55 }} className="grid shrink-0 place-items-center rounded-full bg-sun/40 leading-none">
      {emoji ?? '🍎'}
    </span>
  );
}

interface Picked {
  tile: TileModel;
  avatar?: ReadyAvatarView;
}

/**
 * The caregiver's home (mockup 5). A teacher sees their classroom's children; on a registered classroom tablet the
 * "<Teacher> · Switch" chip hands the tablet to the next teacher. A home caregiver (nanny) sees the same grid of the
 * children they look after, on a phone. A ready child opens the reasons (or, with two parents, who to call first).
 */
export function Roster() {
  const { me, device, unregisterDevice } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const profile = useProfileTrigger();
  const [switchOpen, setSwitchOpen] = useState(false);
  const [chosenRoom, setChosenRoom] = useState<string | undefined>();
  const [picked, setPicked] = useState<Picked | null>(null);

  const { teacherOrgs, adminOrgs } = me.roles;
  const orgs = [...teacherOrgs, ...adminOrgs];
  const orgId = device?.orgId ?? orgs[0]?.id;
  const orgMode = !!orgId;
  const orgName = orgs.find((o) => o.id === orgId)?.name ?? '';
  const registered = !!device;

  // A registered classroom tablet stays awake while the roster is up (Screen Wake Lock, as in the live session).
  useKeepAwake(registered);

  // Whoever was acting before must not stay on screen under a new identity: drop their cached rosters.
  const dropCaches = () => {
    qc.removeQueries({ queryKey: qk.rosterAll() });
    qc.removeQueries({ queryKey: qk.myClassroomsAll() });
  };
  const { acting, loaded, reload } = useActing(() => {
    dropCaches();
    toast.info('Your shift timed out. Please pick who is teaching 💛');
    setSwitchOpen(true);
  });
  // A registered tablet asks who is teaching, unless a teacher is already signed in on it, and only when someone on
  // the staff list has a PIN to answer with (else the sheet would be a dead end; the chip still opens it).
  // Only once per app session (module state), so coming back from a call does not ask again.
  const wantPrompt = registered && loaded && !acting && !switchPrompt.shown;
  const staffList = useStaffSwitch(device?.orgId, device?.deviceId, wantPrompt);
  const someoneHasPin = !!staffList.data?.some((m) => m.hasPin);
  // A failing list (e.g. DEVICE_UNKNOWN) still opens the sheet: it knows how to handle that.
  const listFailed = staffList.isError;
  useEffect(() => {
    // Someone already teaching counts as asked (so End shift does not pop the sheet straight back up).
    if (loaded && acting) switchPrompt.shown = true;
    if (wantPrompt && (someoneHasPin || listFailed) && !switchPrompt.shown) {
      switchPrompt.shown = true;
      setSwitchOpen(true);
    }
  }, [wantPrompt, someoneHasPin, listFailed, loaded, acting]);

  const actingId = acting?.teacherUserId ?? null;
  // Wait for the stored acting identity so the first fetch is already keyed (and sent) as the right teacher.
  const rooms = useMyClassrooms(orgMode && loaded ? orgId : undefined, actingId);
  const roomsSettled = !orgMode || (loaded && !rooms.isPending);
  const classrooms = useMemo(() => (Array.isArray(rooms.data) ? rooms.data : []), [rooms.data]);
  const room = classrooms.find((c) => c.id === chosenRoom) ?? classrooms[0];
  const roster = useRoster(orgMode && loaded && roomsSettled ? orgId : undefined, room?.id, actingId);
  const nanny = useCaregiverChildren(!orgMode);

  const tiles: TileModel[] = useMemo(() => {
    if (orgMode) {
      return (Array.isArray(roster.data) ? roster.data : []).map((t) => ({ ...t, key: t.enrollmentId }));
    }
    return (Array.isArray(nanny.data) ? nanny.data : []).map((c) => ({
      key: c.id,
      childId: c.id,
      name: c.name,
      photoUrl: c.photoUrl,
      readyAvatars: c.readyAvatars,
      status: c.readyAvatars.length ? ('ready' as const) : ('setup_pending' as const),
    }));
  }, [orgMode, roster.data, nanny.data]);

  const active = orgMode ? roster : nanny;
  const loading = orgMode ? !roomsSettled || roster.isPending : nanny.isPending;
  const failed = !loading && active.isError;

  const refresh = async () => {
    await Promise.all([active.refetch(), orgMode ? rooms.refetch() : Promise.resolve()]);
  };
  const pull = usePullToRefresh(refresh);

  const afterSwitch = async () => {
    setSwitchOpen(false);
    setChosenRoom(undefined);
    // Everything the roster shows depends on who is acting: drop it, then fetch as the new teacher (new cache key).
    dropCaches();
    await reload();
  };
  const endShift = async () => {
    await clearActingToken();
    setSwitchOpen(false);
    setChosenRoom(undefined);
    dropCaches();
    await reload();
    toast.info('Shift ended. See you next time 💛');
  };

  const onTap = (t: TileModel) => {
    if (t.status !== 'ready' || !t.childId || !t.readyAvatars.length) {
      toast.info(whyNot(t));
      return;
    }
    // One avatar goes straight to the reasons; two ask which parent first.
    setPicked({ tile: t, avatar: t.readyAvatars.length === 1 ? t.readyAvatars[0] : undefined });
  };

  const call = (reason: Reason) => {
    if (!picked?.avatar || !picked.tile.childId) return;
    const { tile, avatar } = picked;
    rememberCall({ childId: tile.childId!, childName: tile.name, parentTitle: avatar.parentTitle, parentName: avatar.parentName, startedAt: Date.now() });
    navigate('/live/child', {
      state: {
        avatarId: avatar.avatarId,
        childId: tile.childId,
        reason,
        childName: tile.name,
        caregiverName: acting?.teacherName ?? me.user.name,
        parentTitle: avatar.parentTitle,
        parentPhotoUrl: avatar.photoUrl,
        returnTo: '/caregiver/done',
      },
    });
  };

  const kids = nanny.data ?? [];
  const first = kids[0];
  const manyFamilies = new Set(kids.map((k) => k.familyLabel)).size > 1 || me.roles.homeCaregiverFamilies.length > 1;
  const title = orgMode
    ? (room?.name ?? orgName ?? 'Classroom')
    : first && (kids.length === 1 || manyFamilies)
      ? `${first.name} & friends`
      : (first?.familyLabel ?? 'Our little ones');
  const sub = orgMode ? [orgName, todayLabel()].filter(Boolean).join(' · ') : todayLabel();

  return (
    <Screen>
      <div {...pull.bind} className="mx-auto w-full max-w-[1100px]">
        <div aria-hidden={pull.pull === 0 && !pull.refreshing ? true : undefined} style={{ height: pull.pull }} className="grid place-items-end justify-center overflow-hidden text-[13px] text-mutedText">
          {pull.pull > 0 ? <span>{pull.refreshing ? 'Refreshing…' : pull.ready ? 'Let go to refresh' : 'Pull to refresh'}</span> : null}
        </div>

        <header className="flex flex-wrap items-center justify-between gap-3 pb-3 pt-1">
          <div className="flex min-w-0 items-center gap-3">
            {orgMode ? <Emblem assetKey={room?.assetKey ?? null} emoji={room?.emoji ?? null} size={56} /> : <Emblem assetKey={null} emoji="🧸" size={56} />}
            <div className="min-w-0">
              <h1 className="truncate text-[26px] font-semibold leading-tight text-ink">{title}</h1>
              <p className="truncate text-[14px] text-mutedText">{sub}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {registered ? (
              <button
                type="button"
                onClick={() => setSwitchOpen(true)}
                className="inline-flex min-h-touch items-center gap-1.5 rounded-full border-2 border-ink bg-white px-4 text-[14px] font-medium text-ink shadow-chunky active:translate-y-[3px] active:shadow-none"
              >
                <span aria-hidden="true">👩🏽‍🏫</span>
                <span>
                  {acting?.teacherName ? (
                    <>
                      {acting.teacherName} · <span className="text-coralD">Switch</span>
                    </>
                  ) : (
                    <>
                      Who&apos;s teaching? · <span className="text-coralD">Switch</span>
                    </>
                  )}
                </span>
              </button>
            ) : null}
            {profile ? (
              <button type="button" aria-label="Open profile" onClick={profile.open} className="grid h-11 w-11 place-items-center rounded-full active:bg-ink/10">
                <Avatar name={profile.name} size={36} />
              </button>
            ) : null}
          </div>
        </header>

        {orgMode && classrooms.length > 1 ? (
          <div role="tablist" aria-label="Classroom" className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">
            {classrooms.map((c) => {
              const on = c.id === room?.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setChosenRoom(c.id)}
                  className={clsx(
                    'inline-flex min-h-touch shrink-0 items-center gap-2 rounded-full border-2 border-ink px-4 text-[15px] font-semibold',
                    on ? 'bg-sun shadow-chunky' : 'bg-white',
                  )}
                >
                  <Emblem assetKey={c.assetKey} emoji={c.emoji} size={24} />
                  {c.name}
                </button>
              );
            })}
          </div>
        ) : null}

        {loading ? (
          <div className="grid grid-cols-2 gap-3 min-[700px]:grid-cols-3 min-[900px]:grid-cols-4" aria-busy="true">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} shape="card" height={148} />
            ))}
          </div>
        ) : failed ? (
          <ErrorState
            offline={active.error instanceof ApiError && active.error.code === 'NETWORK'}
            body={active.error instanceof ApiError ? friendlyMessage(active.error.code) : undefined}
            onRetry={() => void refresh()}
            retrying={active.isFetching}
          />
        ) : tiles.length === 0 ? (
          <EmptyState
            asset={orgMode ? 'empty.rosterEmpty' : 'empty.noChildren'}
            title={orgMode ? 'No little ones here yet' : 'No children yet'}
            body={orgMode ? 'Ask your daycare admin to add children to this classroom, and they will show up here.' : 'When a family adds you as a caregiver, their child will show up here.'}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 min-[700px]:grid-cols-3 min-[900px]:grid-cols-4">
            {tiles.map((t) => (
              <ChildTile key={t.key} tile={t} onTap={onTap} />
            ))}
          </div>
        )}
      </div>

      <AvatarPicker
        open={!!picked && !picked.avatar}
        onClose={() => setPicked(null)}
        childName={picked?.tile.name ?? ''}
        photoUrl={picked?.tile.photoUrl}
        avatars={picked?.tile.readyAvatars ?? []}
        onPick={(a) => setPicked((p) => (p ? { ...p, avatar: a } : p))}
      />
      <ReasonSheet
        open={!!picked?.avatar}
        onClose={() => setPicked(null)}
        childName={picked?.tile.name ?? ''}
        photoUrl={picked?.tile.photoUrl}
        parentTitle={picked?.avatar?.parentTitle ?? 'Mom'}
        onCall={call}
      />
      {device ? (
        <SwitchTeacher
          open={switchOpen}
          onClose={() => setSwitchOpen(false)}
          orgId={device.orgId}
          deviceId={device.deviceId}
          acting={acting}
          onSwitched={() => void afterSwitch()}
          onEndShift={() => void endShift()}
          onDeviceGone={() => {
            setSwitchOpen(false);
            dropCaches();
            unregisterDevice();
          }}
        />
      ) : null}
    </Screen>
  );
}
