import { createContext, createElement, useContext, type ReactNode } from 'react';

/**
 * Everything the onboarding screens need from Clerk, as plain async calls. They THROW the raw Clerk error on
 * failure (screens map it with friendlyClerkError). The Clerk-backed implementation lives in clerkOps.tsx; tests and
 * the dev preview inject fakes through AuthOpsProvider.
 */
export interface AuthOps {
  /** Creates the account. 'verify' = an email code was sent; 'complete' = signed in already. */
  signUp(v: { firstName: string; lastName: string; email: string; password: string }): Promise<'verify' | 'complete'>;
  /** Checks the sign-up email code and signs in. */
  verifySignUp(code: string): Promise<void>;
  resendSignUp(): Promise<void>;
  /**
   * An unfinished sign-up Clerk still holds for this device (the app was killed or the WebView crashed between
   * "Create my account" and the email code), or null. Optional: fakes may leave it out.
   */
  pendingSignUp?(): { email: string } | null;
  /** Continues that sign-up: 'verify' = a fresh email code was sent; 'complete' = it was already done and is now signed in. */
  resumeSignUp?(): Promise<'verify' | 'complete'>;
  /** 'verify' = new device: an email code was sent (Clerk "client trust"). */
  signIn(v: { email: string; password: string }): Promise<'complete' | 'verify'>;
  verifySignIn(code: string): Promise<void>;
  resendSignIn(): Promise<void>;
  sendReset(email: string): Promise<void>;
  verifyReset(code: string): Promise<void>;
  /** Sets the new password and signs in. */
  submitReset(password: string): Promise<void>;
  /** Signs in with a Backend-API ticket (the demo). `getToken` reads the NEW session's token before AuthGate wires up. */
  ticketSignIn(ticket: string): Promise<{ getToken: () => Promise<string | null> }>;
}

const Ctx = createContext<AuthOps | null>(null);

export function AuthOpsProvider({ value, children }: { value: AuthOps; children: ReactNode }) {
  return createElement(Ctx.Provider, { value }, children);
}

export function useAuthOps(): AuthOps {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuthOps outside AuthOpsProvider');
  return v;
}
