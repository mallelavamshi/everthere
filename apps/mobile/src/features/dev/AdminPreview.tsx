import { Route, Routes } from 'react-router-dom';
import type { MeResponse } from '@everthere/shared';
import { SessionProvider } from '../../shell/SessionContext';
import { AdminRoutes } from '../admin/AdminRoutes';

// Dev-only: the real admin screens with a fake signed-in director (no Clerk), for screenshots against a mocked API.
// Enabled by localStorage 'everthere.devPreview' = 'admin' (see router.tsx). Never shipped.

export default function AdminPreview() {
  const me: MeResponse = {
    user: { id: 'dev_admin', name: 'Dana Director', email: 'dana@example.com', isDemo: false },
    roles: { parent: false, adminOrgs: [{ id: 'o1', name: 'Little Acorns' }], teacherOrgs: [], homeCaregiverFamilies: [] },
  };
  return (
    <SessionProvider me={me}>
      <Routes>
        <Route path="/admin/*" element={<AdminRoutes />} />
      </Routes>
    </SessionProvider>
  );
}
