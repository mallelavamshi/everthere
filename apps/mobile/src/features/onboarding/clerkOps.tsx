import { useMemo, useRef, type ReactNode } from 'react';
import { useClerk, useSignIn, useSignUp } from '@clerk/react';
import { AuthOpsProvider, type AuthOps } from './authOps';

// Clerk Core 3 "signal" API (@clerk/react 6), headless. The flow below is the one the Task 4 device spike proved in
// the Android WebView: password sign-in on a new device answers `needs_client_trust` and wants an email code
// (`signIn.mfa.sendEmailCode()` + `verifyEmailCode()`) before `finalize()`.

type Fail = { error: unknown } | { error: null };
/** Core 3 calls resolve `{ error }` instead of throwing: unwrap so the screens can use try/catch. */
async function ok(p: Promise<Fail>): Promise<void> {
  const { error } = await p;
  if (error) throw error;
}

const NEEDS_CODE = new Set(['needs_client_trust', 'needs_second_factor']);

export function ClerkAuthOpsProvider({ children }: { children: ReactNode }) {
  const clerk = useClerk();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  // Always read the latest resources at call time (a call mid-flow must see the status the previous call produced).
  const live = useRef({ clerk, signIn, signUp });
  live.current = { clerk, signIn, signUp };

  const ops = useMemo<AuthOps>(() => {
    const si = () => live.current.signIn;
    const su = () => live.current.signUp;
    const finishSignIn = async () => {
      if (si().status !== 'complete') throw { code: 'auth_incomplete' };
      await ok(si().finalize());
    };
    const finishSignUp = async () => {
      if (su().status !== 'complete') throw { code: 'auth_incomplete' };
      await ok(su().finalize());
    };
    return {
      async signUp({ firstName, lastName, email, password }) {
        await ok(su().password({ emailAddress: email, password, firstName, lastName }));
        if (su().status === 'complete') {
          await finishSignUp();
          return 'complete';
        }
        await ok(su().verifications.sendEmailCode());
        return 'verify';
      },
      async verifySignUp(code) {
        await ok(su().verifications.verifyEmailCode({ code }));
        await finishSignUp();
      },
      resendSignUp: () => ok(su().verifications.sendEmailCode()),
      // Clerk keeps the in-progress sign-up on its client across app restarts, so a sign-up cut short (the WebView
      // renderer crashed during Clerk's bot check on old WebViews, or the app was swiped away) can carry on.
      pendingSignUp() {
        const s = su();
        if (!s?.id || !s.emailAddress) return null;
        if (s.status !== 'missing_requirements' && s.status !== 'complete') return null;
        if (s.abandonAt != null && s.abandonAt <= Date.now()) return null;
        return { email: s.emailAddress };
      },
      async resumeSignUp() {
        if (su().status === 'complete') {
          await finishSignUp();
          return 'complete';
        }
        await ok(su().verifications.sendEmailCode());
        return 'verify';
      },

      async signIn({ email, password }) {
        await ok(si().password({ identifier: email, password }));
        if (si().status === 'complete') {
          await finishSignIn();
          return 'complete';
        }
        if (NEEDS_CODE.has(si().status)) {
          await ok(si().mfa.sendEmailCode());
          return 'verify';
        }
        throw { code: 'auth_incomplete' };
      },
      async verifySignIn(code) {
        await ok(si().mfa.verifyEmailCode({ code }));
        await finishSignIn();
      },
      resendSignIn: () => ok(si().mfa.sendEmailCode()),

      async sendReset(email) {
        await ok(si().create({ identifier: email }));
        await ok(si().resetPasswordEmailCode.sendCode());
      },
      verifyReset: (code) => ok(si().resetPasswordEmailCode.verifyCode({ code })),
      async submitReset(password) {
        await ok(si().resetPasswordEmailCode.submitPassword({ password }));
        await finishSignIn();
      },

      async ticketSignIn(ticket) {
        await ok(si().create({ strategy: 'ticket', ticket }));
        await finishSignIn();
        return { getToken: async () => (await live.current.clerk.session?.getToken()) ?? null };
      },
    };
  }, []);

  return <AuthOpsProvider value={ops}>{children}</AuthOpsProvider>;
}
