import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SessionItem } from '@everthere/shared';
import { ApiError, friendlyMessage } from '../../lib/api';
import { useChildren, useSessions } from '../../lib/queries';
import { useSelectedChild } from '../../lib/selectedChild';
import { Avatar, Button, Chip, EmptyState, ErrorState, Skeleton, Spinner } from '../../ui';
import { ParentScreen } from '../parent/ParentScreen';
import { SessionCard } from './SessionCard';
import { groupByDay } from './sessionCopy';
import { usePullToRefresh } from './usePullToRefresh';

const EMPTY_BODY = (name?: string) =>
  `When ${name ?? 'your little one'} has a wobbly moment and your avatar steps in, the story will be right here, with how it went and how they felt after.`;

/** Calls `onNear` when the sentinel scrolls into view. Does nothing where IntersectionObserver is missing (the button covers it). */
function useNearEnd(onNear: () => void, active: boolean, key: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onNear);
  cb.current = onNear;
  useEffect(() => {
    const el = ref.current;
    if (!active || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) cb.current();
      },
      { rootMargin: '240px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [active, key]);
  return ref;
}

/** Sessions tab: this child's comfort calls, newest first, under Today / Yesterday / date headings. */
export function SessionsTab({ now }: { now?: Date } = {}) {
  const navigate = useNavigate();
  const children = useChildren();
  const [pick, setPick] = useSelectedChild();
  const list = children.data ?? [];
  const focus = list.find((c) => c.id === pick) ?? list[0];
  const sessions = useSessions(focus?.id);

  // A page that repeats a session (one finished between requests) must not show it twice.
  const items = useMemo(() => {
    const seen = new Map<string, SessionItem>();
    for (const p of sessions.data?.pages ?? []) for (const s of p.items) if (!seen.has(s.id)) seen.set(s.id, s);
    return [...seen.values()];
  }, [sessions.data]);
  const groups = useMemo(() => groupByDay(items, now), [items, now]);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = sessions;
  const more = () => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  };
  const sentinel = useNearEnd(more, !!hasNextPage, items.length);

  // Loaded pages stay put while refreshing, and stay if the refresh fails.
  const pull = usePullToRefresh(async () => {
    if (focus) await sessions.refetch();
  });

  const err = (children.error ?? sessions.error) as unknown;

  return (
    <ParentScreen tab="sessions" title="Sessions">
      <div data-testid="pull-zone" {...pull.bind} className="flex min-h-full flex-col gap-3 pt-1">
        <div
          aria-live="polite"
          className="flex items-center justify-center overflow-hidden text-[13px] font-medium text-mutedText transition-[height] duration-200 motion-reduce:transition-none"
          style={{ height: pull.pull }}
        >
          {pull.refreshing ? (
            <span className="flex items-center gap-2">
              <Spinner /> Refreshing…
            </span>
          ) : pull.pull > 8 ? (
            <span>{pull.ready ? 'Let go to refresh' : 'Pull to refresh'}</span>
          ) : null}
        </div>

        {list.length > 1 ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a child">
            {list.map((c) => (
              <Chip
                key={c.id}
                selected={c.id === focus?.id}
                icon={<Avatar src={c.photoUrl} emoji={c.photoUrl ? undefined : c.name.charAt(0).toUpperCase()} size={24} />}
                onClick={() => setPick(c.id)}
              >
                {c.name}
              </Chip>
            ))}
          </div>
        ) : null}

        {children.isPending || (focus && sessions.isPending) ? (
          <Skeleton shape="card" count={3} height={120} />
        ) : children.isError || (sessions.isError && !items.length) ? (
          <ErrorState
            offline={err instanceof ApiError && err.code === 'NETWORK'}
            body={err instanceof ApiError ? friendlyMessage(err.code) : undefined}
            onRetry={() => void (children.isError ? children.refetch() : sessions.refetch())}
            retrying={children.isFetching || sessions.isFetching}
          />
        ) : !items.length ? (
          <EmptyState asset="empty.noSessions" title="No comfort calls yet" body={EMPTY_BODY(focus?.name)} />
        ) : (
          <>
            {groups.map((g) => (
              <section key={g.label} aria-label={g.label} className="flex flex-col gap-2.5">
                <h2 className="px-1 pt-1 text-[13px] font-semibold uppercase tracking-[0.06em] text-mutedText">
                  {g.label}
                </h2>
                {g.items.map((s) => (
                  <SessionCard key={s.id} s={s} onClick={() => navigate(`/parent/sessions/${encodeURIComponent(s.id)}`)} />
                ))}
              </section>
            ))}
            {hasNextPage ? (
              <div ref={sentinel} className="flex justify-center py-2">
                <Button variant="ghost" size="sm" loading={isFetchingNextPage} onClick={more}>
                  Load more
                </Button>
              </div>
            ) : (
              <p className="py-3 text-center text-[13px] text-mutedText">That&apos;s everything so far 💛</p>
            )}
          </>
        )}
      </div>
    </ParentScreen>
  );
}

export default SessionsTab;
