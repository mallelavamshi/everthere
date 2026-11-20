import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Reason } from '@everthere/shared';
import { Button, EmptyState, Screen } from '../ui';
import type { FakeKit, FakeScenario } from './fakeSdk';
import { LiveSession } from './LiveSession';

/**
 * Route state for /live/:mode (`test` | `child`). Callers navigate with
 *   navigate('/live/child', { state: { avatarId, childId, reason, childName, caregiverName, parentTitle, songTitle, songLyrics, returnTo } })
 * When the call is over the route goes to `returnTo` (replace) with `{ endedSessionId }` in its state, or back.
 */
export interface LiveRouteState {
  avatarId: string;
  childId?: string;
  reason?: Reason;
  childName?: string;
  caregiverName?: string;
  parentTitle: string;
  songTitle?: string;
  songLyrics?: string;
  returnTo?: string;
}

// DEV-only fake Napster (?fake=1). `import.meta.env.DEV` is statically false in production builds, so this import
// and the fakeSdk chunk are removed from the bundle.
const loadFake = import.meta.env.DEV ? () => import('./fakeSdk') : null;

const DEMO_STATE: LiveRouteState = {
  avatarId: 'fake_avatar',
  childId: 'fake_child',
  reason: 'missing_parent',
  childName: 'Mia',
  caregiverName: 'Ms. Jess',
  parentTitle: 'Mom',
  songTitle: 'You Are My Sunshine',
  songLyrics: 'You are my sunshine, my only sunshine. You make me happy when skies are grey.',
};

export function LiveRoute() {
  const { mode: rawMode } = useParams();
  const mode = rawMode === 'child' ? 'child' : rawMode === 'test' ? 'test' : null;
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const wantFake = !!loadFake && params.get('fake') === '1';
  const [fake, setFake] = useState<FakeKit | null>(null);

  useEffect(() => {
    if (!wantFake || !loadFake) return;
    let live = true;
    void loadFake().then((m) => live && setFake(m.createFakeKit((params.get('scenario') as FakeScenario | null) ?? 'flag')));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantFake]);

  const routeState = (location.state as LiveRouteState | null) ?? (wantFake ? DEMO_STATE : null);
  const valid = !!mode && !!routeState?.avatarId && !!routeState.parentTitle && (mode === 'test' || (!!routeState.childId && !!routeState.reason));

  if (!valid || !routeState || !mode) {
    return (
      <Screen back={() => navigate(-1)}>
        <EmptyState
          asset="empty.noSessions"
          title="Let's start that call again"
          body="This call needs to be started from a child's or an avatar's page."
          action={<Button onClick={() => navigate('/', { replace: true })}>Go home</Button>}
        />
      </Screen>
    );
  }
  if (wantFake && !fake) return <div className="h-full w-full bg-cream" />;

  const onDone = (sessionId?: string, durationS?: number) => {
    if (routeState.returnTo) navigate(routeState.returnTo, { replace: true, state: { endedSessionId: sessionId, endedDurationS: durationS } });
    else if (location.key !== 'default') navigate(-1);
    else navigate('/', { replace: true });
  };

  const n = (k: string) => {
    const v = Number(params.get(k));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  };
  const limits = wantFake && (n('warnAt') || n('maxAt')) ? { warnMs: n('warnAt') ?? 480_000, maxMs: n('maxAt') ?? 600_000 } : undefined;

  return (
    <LiveSession
      mode={mode}
      {...routeState}
      onDone={onDone}
      start={fake?.start}
      sdk={fake?.sdk}
      request={fake?.request}
      micCheck={fake?.micCheck}
      limits={limits}
    />
  );
}

export default LiveRoute;
