import { Route, Routes } from 'react-router-dom';
import type { MeResponse } from '@everthere/shared';
import { SessionProvider } from '../../shell/SessionContext';
import { CaregiverRoutes } from '../caregiver/CaregiverRoutes';
import { CheckIn } from '../caregiver/CheckIn';

// Dev-only: the real caregiver screens with a fake signed-in teacher or nanny (no Clerk), for screenshots against a mocked
// API. Enabled by localStorage 'everthere.devPreview' = 'teacher' | 'nanny' (see router.tsx). Never shipped.

export default function CaregiverPreview({ nanny }: { nanny: boolean }) {
  const me: MeResponse = nanny
    ? {
        user: { id: 'dev_nanny', name: 'Nora Nanny', email: 'nora@example.com', isDemo: false },
        roles: { parent: false, adminOrgs: [], teacherOrgs: [], homeCaregiverFamilies: [{ id: 'f1', label: 'Kim family' }] },
      }
    : {
        user: { id: 'dev_tablet', name: 'Classroom Tablet', email: 'tablet@example.com', isDemo: false },
        roles: { parent: false, adminOrgs: [], teacherOrgs: [{ id: 'org1', name: 'Little Acorns Daycare' }], homeCaregiverFamilies: [] },
      };
  return (
    <SessionProvider me={me}>
      <Routes>
        <Route path="/caregiver/checkin-demo" element={<CheckIn sessionId="s1" childName="Mia" parentTitle="Mom" parentName="Sarah" durationS={118} onDone={() => {}} />} />
        <Route path="/caregiver/*" element={<CaregiverRoutes />} />
      </Routes>
    </SessionProvider>
  );
}
