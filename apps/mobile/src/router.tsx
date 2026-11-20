import { lazy, Suspense } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { AuthGate } from './shell/AuthGate';

// Dev-only gallery. `import.meta.env.DEV` is statically false in production builds, so this route and the lazy
// chunk are dead-code eliminated and never ship.
const Gallery = import.meta.env.DEV ? lazy(() => import('./features/dev/Gallery')) : null;
const OnboardingPreview = import.meta.env.DEV ? lazy(() => import('./features/dev/OnboardingPreview')) : null;
// Dev-only: the live screen outside the auth gate (use with ?fake=1), so it can be screenshotted without Clerk.
const LivePreview = import.meta.env.DEV ? lazy(() => import('./live/LiveRoute')) : null;

// Dev-only: /parent/* rendered with a fake parent when localStorage 'everthere.devPreview' is set (screenshots); otherwise the
// normal auth gate (same single '*' route as production). Statically dead code in production builds.
const ParentPreview = import.meta.env.DEV ? lazy(() => import('./features/dev/ParentPreview')) : null;
const CaregiverPreview = import.meta.env.DEV ? lazy(() => import('./features/dev/CaregiverPreview')) : null;
const AdminPreview = import.meta.env.DEV ? lazy(() => import('./features/dev/AdminPreview')) : null;
function RootGate() {
  let mode: string | null = null;
  try {
    mode = localStorage.getItem('everthere.devPreview');
  } catch {
    /* no storage */
  }
  const { pathname } = useLocation();
  const previewing = !!ParentPreview && (mode === 'parent' || mode === 'demo') && /^\/parent(\/|$)/.test(pathname);
  const careMode = !!CaregiverPreview && (mode === 'teacher' || mode === 'nanny') && /^\/caregiver(\/|$)/.test(pathname);
  const adminMode = !!AdminPreview && mode === 'admin' && /^\/admin(\/|$)/.test(pathname);
  if (adminMode && AdminPreview) {
    const Admin = AdminPreview;
    return (
      <Suspense fallback={null}>
        <Admin />
      </Suspense>
    );
  }
  if (careMode && CaregiverPreview) {
    const Care = CaregiverPreview;
    return (
      <Suspense fallback={null}>
        <Care nanny={mode === 'nanny'} />
      </Suspense>
    );
  }
  // Without the flag this is exactly the production route: AuthGate at '*'.
  if (!previewing || !ParentPreview) return <AuthGate />;
  const Preview = ParentPreview;
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/parent/*" element={<Preview demo={mode === 'demo'} />} />
      </Routes>
    </Suspense>
  );
}

/**
 * /onboarding/*, /parent/*, /admin/*, /caregiver/* and /live/* live behind the auth gate (see shell/AuthGate);
 * `/` redirects through homeFor. Later tasks replace each section's "Coming together" screen.
 */
export function AppRoutes() {
  return (
    <Routes>
      {Gallery ? (
        <Route
          path="/dev/gallery"
          element={
            <Suspense fallback={null}>
              <Gallery />
            </Suspense>
          }
        />
      ) : null}
      {OnboardingPreview ? (
        <Route
          path="/dev/onboarding/*"
          element={
            <Suspense fallback={null}>
              <OnboardingPreview />
            </Suspense>
          }
        />
      ) : null}
      {LivePreview ? (
        <Route
          path="/dev/live/:mode"
          element={
            <Suspense fallback={null}>
              <LivePreview />
            </Suspense>
          }
        />
      ) : null}
      <Route path="*" element={import.meta.env.DEV ? <RootGate /> : <AuthGate />} />
    </Routes>
  );
}
