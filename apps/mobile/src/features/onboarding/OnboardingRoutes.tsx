import { Navigate, Route, Routes } from 'react-router-dom';
import { useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { signOutAndClear } from '../../lib/session';
import { toast } from '../../ui';
import { useSession } from '../../shell/SessionContext';
import { DaycareStart } from './DaycareStart';
import { ForgotPassword } from './ForgotPassword';
import { useAuthTarget } from './flow';
import { Join } from './Join';
import { ParentStart } from './ParentStart';
import { SignIn } from './SignIn';
import { SignUp } from './SignUp';
import { useOnbPath } from './Step';
import { Welcome } from './Welcome';

/** Signed in with a role already: the doors are not for you, go home. */
function SignedInIndex() {
  const { home } = useSession();
  return home === '/onboarding' ? <SignedInWelcome /> : <Navigate to={home} replace />;
}

/** Welcome for a signed-in person with no role yet, with a way out: "Signed in as <email> · Sign out". */
function SignedInWelcome() {
  const { me } = useSession();
  const { signOut } = useClerk();
  const qc = useQueryClient();
  const onSignOut = async () => {
    if (!(await signOutAndClear(signOut, qc))) toast.error("We couldn't sign you out just now. Please try again.");
  };
  return <Welcome signedIn account={{ email: me.user.email, onSignOut }} />;
}

/** Sign-up and sign-in screens a person lands on the instant their session starts: move them on. */
function AlreadySignedIn() {
  const { dest } = useAuthTarget();
  return <Navigate to={dest} replace />;
}

/**
 * Everything under /onboarding. Signed out: Welcome, sign up, sign in, forgot password, join, demo.
 * Signed in: the parent and daycare profile steps and join (and Welcome, for a person with no role yet).
 * `guardHome` off is for the dev preview, which has no session.
 */
export function OnboardingRoutes({ signedIn, guardHome = signedIn }: { signedIn: boolean; guardHome?: boolean }) {
  const p = useOnbPath();
  const needSignUp = (door: 'parent' | 'daycare') => <Navigate to={p(`/signup?door=${door}`)} replace />;
  return (
    <Routes>
      <Route index element={signedIn ? guardHome ? <SignedInIndex /> : <Welcome signedIn /> : <Welcome />} />
      <Route path="signup" element={signedIn ? <AlreadySignedIn /> : <SignUp />} />
      <Route path="signin" element={signedIn ? <AlreadySignedIn /> : <SignIn />} />
      <Route path="forgot" element={signedIn ? <AlreadySignedIn /> : <ForgotPassword />} />
      <Route path="join" element={<Join signedIn={signedIn} />} />
      <Route path="parent/start" element={signedIn ? <ParentStart /> : needSignUp('parent')} />
      <Route path="daycare/start" element={signedIn ? <DaycareStart /> : needSignUp('daycare')} />
      <Route path="*" element={<Navigate to={p('/')} replace />} />
    </Routes>
  );
}
