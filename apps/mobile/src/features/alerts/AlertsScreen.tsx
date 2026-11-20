import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import type { AlertView } from '@everthere/shared';
import { ApiError, friendlyMessage } from '../../lib/api';
import { routeForAlert } from '../../lib/alertsRoute';
import { qk, useAlerts } from '../../lib/queries';
import { Button, EmptyState, ErrorState, Screen, Skeleton, toast } from '../../ui';
import { relativeTime } from '../sessions/sessionCopy';
import { markAlertsRead } from './alertsApi';

const ICON: Record<string, { icon: string; bg: string; label: string }> = {
  summary: { icon: '💬', bg: 'bg-mint', label: 'Summary' },
  flag: { icon: '⚑', bg: 'bg-flag', label: 'Worth a look' },
  invite: { icon: '💌', bg: 'bg-sky', label: 'Invite' },
  avatar_ready: { icon: '✨', bg: 'bg-sun', label: 'Avatar' },
};
const FALLBACK = { icon: '🔔', bg: 'bg-lilac', label: 'Update' };

function AlertRow({ a, onOpen }: { a: AlertView; onOpen: () => void }) {
  const k = ICON[a.kind] ?? FALLBACK;
  const unread = a.readAt == null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={clsx(
        'flex min-h-[64px] w-full items-center gap-3 rounded-card border-card px-3 py-3 text-left active:bg-sun/30',
        unread ? 'border-sunD bg-white' : 'border-line bg-cream',
      )}
    >
      <span data-testid={`alert-icon-${a.kind}`} aria-hidden="true" className={clsx('grid h-11 w-11 shrink-0 place-items-center rounded-full text-[20px]', k.bg)}>
        {k.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={clsx('block text-[16px] leading-snug', unread ? 'font-semibold' : 'font-medium')}>{a.title}</span>
        {a.body ? <span className="mt-0.5 line-clamp-2 block text-[14px] leading-snug text-mutedText">{a.body}</span> : null}
        <span className="mt-0.5 block text-[12px] text-mutedText">{relativeTime(a.createdAt)}</span>
      </span>
      {unread ? <span aria-label="Unread" className="h-2.5 w-2.5 shrink-0 rounded-full bg-coralD" /> : null}
    </button>
  );
}

/** Everything the app has told the parent about: summaries, moments worth a look, invites, avatar news. */
export function AlertsScreen() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const alerts = useAlerts(false);
  const list = alerts.data ?? [];
  const unreadIds = list.filter((a) => a.readAt == null).map((a) => a.id);

  const markRead = (ids: string[]) => {
    const set = new Set(ids);
    const now = Date.now();
    qc.setQueryData<AlertView[]>(qk.alerts(false), (old) => old?.map((a) => (set.has(a.id) && a.readAt == null ? { ...a, readAt: now } : a)));
    qc.setQueryData<AlertView[]>(qk.alerts(true), (old) => old?.filter((a) => !set.has(a.id)));
  };
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.alerts(false) });
    void qc.invalidateQueries({ queryKey: qk.alerts(true) });
  };

  const markAll = useMutation({
    mutationFn: () => markAlertsRead(unreadIds),
    onSuccess: () => {
      markRead(unreadIds);
      refresh();
    },
    onError: (e) => {
      toast.error(friendlyMessage(e instanceof ApiError ? e.code : 'INTERNAL'));
      refresh();
    },
  });

  const open = (a: AlertView) => {
    if (a.readAt == null) {
      markRead([a.id]);
      void markAlertsRead([a.id]).catch(() => {});
    }
    navigate(routeForAlert(a.kind, a.refId));
  };

  const back = () => navigate('/parent', { replace: true });

  return (
    <Screen title="Alerts" back={back}>
      {alerts.isPending ? (
        <div className="flex flex-col gap-3 pt-1">
          <Skeleton shape="card" count={3} height={72} />
        </div>
      ) : alerts.isError ? (
        <ErrorState
          offline={alerts.error instanceof ApiError && alerts.error.code === 'NETWORK'}
          body={alerts.error instanceof ApiError ? friendlyMessage(alerts.error.code) : undefined}
          onRetry={() => void alerts.refetch()}
          retrying={alerts.isFetching}
        />
      ) : list.length === 0 ? (
        <EmptyState asset="empty.noAlerts" title="All caught up 💛" body="When a comfort call wraps up, or something is worth a look, you'll hear about it here." />
      ) : (
        <div className="flex flex-col gap-3 pt-1">
          {unreadIds.length ? (
            <div className="flex items-center justify-between gap-3 px-1">
              <p className="text-[14px] text-mutedText">{unreadIds.length === 1 ? '1 new' : `${unreadIds.length} new`}</p>
              <Button variant="ghost" size="sm" loading={markAll.isPending} onClick={() => markAll.mutate()}>
                Mark all read
              </Button>
            </div>
          ) : null}
          <ul className="flex flex-col gap-2.5">
            {list.map((a) => (
              <li key={a.id}>
                <AlertRow a={a} onOpen={() => open(a)} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Screen>
  );
}
