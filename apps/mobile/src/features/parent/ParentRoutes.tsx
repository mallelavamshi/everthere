import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { qk, useChildren } from '../../lib/queries';
import { Skeleton } from '../../ui';
import { AlertsScreen } from '../alerts/AlertsScreen';
import { AvatarSetup } from '../avatar/AvatarSetup';
import { Creating } from '../avatar/Creating';
import { MyAvatar } from '../avatar/MyAvatar';
import { TestAndApprove } from '../avatar/TestAndApprove';
import { CaregiversTab } from '../caregivers/CaregiversTab';
import { ComfortPlan } from '../plan/ComfortPlan';
import { SessionDetail } from '../sessions/SessionDetail';
import { SessionsTab } from '../sessions/SessionsTab';
import { ChildForm } from './ChildForm';
import { ParentHome } from './ParentHome';
import { ParentScreen } from './ParentScreen';

function CreatingRoute() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  return (
    <Creating
      avatarId={id}
      onBack={() => navigate('/parent/avatar', { replace: true })}
      onRetake={() => navigate('/parent/avatar/retake', { replace: true })}
      onReady={() => {
        void qc.invalidateQueries({ queryKey: qk.avatar() });
        navigate(`/parent/avatar/test/${id}`, { replace: true });
      }}
    />
  );
}

function TestRoute() {
  const { id = '' } = useParams();
  return <TestAndApprove avatarId={id} />;
}

function EditChildRoute() {
  const { id } = useParams();
  const children = useChildren();
  if (children.isPending) return <ParentScreen tab="home"><Skeleton shape="card" /></ParentScreen>;
  const child = children.data?.find((c) => c.id === id);
  return child ? <ChildForm key={child.id} child={child} /> : <Navigate to="/parent" replace />;
}

/** Everything under /parent/*. The tab screens carry the TabBar; the avatar flows are full screen. */
export function ParentRoutes() {
  return (
    <Routes>
      <Route index element={<ParentHome />} />
      <Route path="avatar" element={<MyAvatar />} />
      <Route path="avatar/setup/*" element={<AvatarSetup intent="new" />} />
      <Route path="avatar/retake/*" element={<AvatarSetup intent="photo" />} />
      <Route path="avatar/voice/*" element={<AvatarSetup intent="voice" />} />
      <Route path="avatar/creating/:id" element={<CreatingRoute />} />
      <Route path="avatar/test/:id" element={<TestRoute />} />
      <Route path="sessions" element={<SessionsTab />} />
      <Route path="sessions/:id" element={<SessionDetail />} />
      <Route path="alerts" element={<AlertsScreen />} />
      <Route path="caregivers" element={<CaregiversTab />} />
      <Route path="children/new" element={<ChildForm />} />
      <Route path="children/:childId/plan/:avatarId" element={<ComfortPlan />} />
      <Route path="children/:id" element={<EditChildRoute />} />
      <Route path="*" element={<Navigate to="/parent" replace />} />
    </Routes>
  );
}

export default ParentRoutes;
