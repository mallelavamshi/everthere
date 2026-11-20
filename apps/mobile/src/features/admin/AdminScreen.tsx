import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, TabBar, type TabItem } from '../../ui';

export type AdminTab = 'dashboard' | 'classrooms' | 'staff' | 'enrollments';

const ITEMS: TabItem<AdminTab>[] = [
  { key: 'dashboard', label: 'Dashboard', icon: '📊' },
  { key: 'classrooms', label: 'Classrooms', icon: '🏫' },
  { key: 'staff', label: 'Staff', icon: '🧑‍🏫' },
  { key: 'enrollments', label: 'Enrollments', icon: '🧸' },
];

export const ADMIN_PATH: Record<AdminTab, string> = {
  dashboard: '/admin',
  classrooms: '/admin/classrooms',
  staff: '/admin/staff',
  enrollments: '/admin/enrollments',
};

/**
 * An admin tab screen: Dashboard, Classrooms, Staff and Enrollments share the TabBar. The body is centred and at most 1100px
 * wide, so a tablet gets room for two columns while a phone stays a single column.
 */
export function AdminScreen({ tab, title, actions, children }: { tab: AdminTab; title: string; actions?: ReactNode; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <Screen
      title={title}
      actions={actions}
      footerPadded={false}
      footer={<TabBar items={ITEMS} value={tab} onChange={(t) => t !== tab && navigate(ADMIN_PATH[t], { replace: true })} />}
    >
      <div className="mx-auto w-full max-w-[1100px]">{children}</div>
    </Screen>
  );
}
