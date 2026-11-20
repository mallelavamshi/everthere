import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth, useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ApiError, friendlyMessage, setTokenGetter } from '../lib/api';
import { queryClient, setQueryUser, useMe } from '../lib/queries';
import type { Role } from '../lib/role';
import { clearLocalSession, signOutAndClear } from '../lib/session';
import { getLastUser, setLastUser } from '../lib/storage';
import { Button, ErrorState, Screen } from '../ui';
import { OnboardingRoutes } from '../features/onboarding/OnboardingRoutes';
import { AdminRoutes } from '../features/admin/AdminRoutes';
import { CaregiverRoutes } from '../features/caregiver/CaregiverRoutes';
import { SharedTabletPrompt } from '../features/caregiver/SharedTabletPrompt';
import { ParentRoutes } from '../features/parent/ParentRoutes';
import { LiveRoute } from '../live/LiveRoute';
import { AlertsBridge } from './AlertsBridge';
import { SessionProvider, useSession } from './SessionContext';
import { Splash } from './Splash';

/** `also`: other roles allowed in too (a daycare admin may open the classroom tablet view without being a teacher). */
function RoleRoute({ role, also = [], children }: { role: Role; also?: Role[]; children: ReactNode }) {
  const { roles, home } = useSession();
  if (![role, ...also].some((r) => roles.includes(r))) return <Navigate to={home} replace />;
  return children;
}

function SignedInRoutes() {
  const { home } = useSession();
  return (
    <Routes>
      <Route path="/" element={<Navigate to={home} replace />} />
      <Route path="/onboarding/*" element={<OnboardingRoutes signedIn />} />
      <Route
        path="/parent/*"
        element={
          <RoleRoute role="parent">
            <ParentRoutes />
          </RoleRoute>
        }
      />
      <Route
        path="/admin/*"
        element={
          <RoleRoute role="admin">
            <AdminRoutes />
          </RoleRoute>
        }
      />
      <Route
        path="/caregiver/*"
        element={
          <RoleRoute role="caregiver" also={['admin']}>
            <CaregiverRoutes />
          </RoleRoute>
        }
      />
      <Route path="/live/:mode" element={<LiveRoute />} />
      <Route path="/live/*" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function SignedIn() {
  const me = useMe();
  const { signOut } = useClerk();
  const qc = useQueryClient();
  if (me.isPending) return <Splash />;
  if (me.isError) {
    const err = me.error;
    const network = err instanceof ApiError && err.code === 'NETWORK';
    return (
      <Screen>
        <ErrorState
          offline={network}
          body={err instanceof ApiError ? friendlyMessage(err.code) : undefined}
          onRetry={() => void me.refetch()}
          retrying={me.isFetching}
        />
        {/* A persistent 401 must not be a dead end. */}
        <div className="flex justify-center">
          <Button variant="ghost" onClick={() => void signOutAndClear(signOut, qc)}>
            Sign out
          </Button>
        </div>
      </Screen>
    );
  }
  return (
    <SessionProvider me={me.data}>
      <AlertsBridge />
      <SignedInRoutes />
      <SharedTabletPrompt />
    </SessionProvider>
  );
}

/**
 * Clerk loading -> splash; signed out -> onboarding; signed in -> /api/me, then the role routes.
 * Whenever the Clerk user changes (including to nobody, e.g. session expiry or sign-out elsewhere) the previous
 * person's cache, acting token and role preference are wiped BEFORE anything of the new user's runs. The last
 * user id is persisted so a change across app launches is caught too.
 */
export function AuthGate() {
  const { isLoaded, userId, getToken } = useAuth();
  const current = userId ?? null;
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const [settled, setSettled] = useState<{ user: string | null } | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    let live = true;
    void (async () => {
      setTokenGetter(null);
      const last = await getLastUser();
      if ((last || null) !== current) {
        await clearLocalSession(queryClient);
        await setLastUser(current);
      }
      if (!live) return;
      setQueryUser(current);
      setTokenGetter(current ? (opts) => getTokenRef.current(opts) : null);
      setSettled({ user: current });
    })();
    return () => {
      live = false;
    };
  }, [isLoaded, current]);

  if (!isLoaded || !settled || settled.user !== current) return <Splash />;
  if (!current) {
    return (
      <Routes>
        <Route path="/onboarding/*" element={<OnboardingRoutes signedIn={false} />} />
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      </Routes>
    );
  }
  return <SignedIn />;
}
