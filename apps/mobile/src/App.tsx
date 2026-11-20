import { useEffect } from 'react';
import { ClerkProvider } from '@clerk/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { MotionRoot, Toaster } from './ui';
import { initKeyboard, useBackButton } from './lib/native';
import { queryClient, wireQueryFocus } from './lib/queries';
import { ClerkAuthOpsProvider } from './features/onboarding/clerkOps';
import { AppRoutes } from './router';
import { ErrorBoundary } from './shell/ErrorBoundary';
import { OfflineBanner } from './shell/OfflineBanner';

/** Native wiring that needs the router: hardware back, keyboard, app resume -> query focus. */
function NativeBridge() {
  useBackButton('/');
  useEffect(() => {
    const offKeyboard = initKeyboard();
    const offFocus = wireQueryFocus();
    return () => {
      offKeyboard();
      offFocus();
    };
  }, []);
  return null;
}

export function App() {
  return (
    <MotionRoot>
      <ErrorBoundary>
        <ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY} afterSignOutUrl="/onboarding">
          <QueryClientProvider client={queryClient}>
            <BrowserRouter>
              <NativeBridge />
              <ClerkAuthOpsProvider>
                <AppRoutes />
              </ClerkAuthOpsProvider>
            </BrowserRouter>
            <OfflineBanner />
          </QueryClientProvider>
        </ClerkProvider>
      </ErrorBoundary>
      <Toaster />
    </MotionRoot>
  );
}
