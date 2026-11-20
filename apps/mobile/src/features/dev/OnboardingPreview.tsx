import { useSearchParams } from 'react-router-dom';
import { AuthOpsProvider, type AuthOps } from '../onboarding/authOps';
import { OnboardingRoutes } from '../onboarding/OnboardingRoutes';
import { OnboardingBaseProvider } from '../onboarding/Step';

// Dev-only: the real onboarding screens with a fake auth backend, mounted at /dev/onboarding/*, so they can be
// screenshotted and clicked through in a plain browser (no Clerk, no API: mock fetch in the page). Never shipped.

const later = <T,>(v: T, ms = 250) => new Promise<T>((r) => setTimeout(() => r(v), ms));

const fake: AuthOps = {
  signUp: () => later('verify' as const),
  verifySignUp: () => later(undefined),
  resendSignUp: () => later(undefined),
  signIn: () => later('verify' as const),
  verifySignIn: () => later(undefined),
  resendSignIn: () => later(undefined),
  sendReset: () => later(undefined),
  verifyReset: () => later(undefined),
  submitReset: () => later(undefined),
  ticketSignIn: () => later({ getToken: async () => null }),
};

export default function OnboardingPreview() {
  const [params] = useSearchParams();
  return (
    <OnboardingBaseProvider value="/dev/onboarding">
      <AuthOpsProvider value={fake}>
        <OnboardingRoutes signedIn={params.get('signedIn') === '1'} guardHome={false} />
      </AuthOpsProvider>
    </OnboardingBaseProvider>
  );
}
