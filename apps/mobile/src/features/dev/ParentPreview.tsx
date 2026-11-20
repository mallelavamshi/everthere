import type { MeResponse } from '@everthere/shared';
import { SessionProvider } from '../../shell/SessionContext';
import { ParentRoutes } from '../parent/ParentRoutes';

// Dev-only: the real parent screens with a fake signed-in parent (no Clerk), for screenshots against a mocked API.
// Enabled by localStorage 'everthere.devPreview' = 'parent' | 'demo' (see router.tsx). Never shipped.

export default function ParentPreview({ demo }: { demo: boolean }) {
  const me: MeResponse = {
    user: { id: 'dev_parent', name: 'Sarah Lee', email: 'sarah@example.com', isDemo: demo },
    roles: { parent: true, adminOrgs: [], teacherOrgs: [], homeCaregiverFamilies: [] },
  };
  return (
    <SessionProvider me={me}>
      <ParentRoutes />
    </SessionProvider>
  );
}
