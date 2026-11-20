import { Navigate, Route, Routes } from 'react-router-dom';
import { CaregiverSession } from './CaregiverSession';
import { Roster } from './Roster';

/** Everything under /caregiver/*: the roster, and the check-in the live call returns to. */
export function CaregiverRoutes() {
  return (
    <Routes>
      <Route index element={<Roster />} />
      <Route path="done" element={<CaregiverSession />} />
      <Route path="*" element={<Navigate to="/caregiver" replace />} />
    </Routes>
  );
}

export default CaregiverRoutes;
