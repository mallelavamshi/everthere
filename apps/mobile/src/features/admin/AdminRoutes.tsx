import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminHome } from './AdminHome';
import { Classrooms } from './Classrooms';
import { DaycareProfile } from './DaycareProfile';
import { Enrollments } from './Enrollments';
import { Staff } from './Staff';

/** Everything under /admin/*: the four tabs, and the daycare profile the dashboard header opens. */
export function AdminRoutes() {
  return (
    <Routes>
      <Route index element={<AdminHome />} />
      <Route path="classrooms" element={<Classrooms />} />
      <Route path="staff" element={<Staff />} />
      <Route path="enrollments" element={<Enrollments />} />
      <Route path="profile" element={<DaycareProfile />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}

export default AdminRoutes;
