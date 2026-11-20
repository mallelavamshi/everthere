import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, TabBar, type TabItem } from '../../ui';
import { BellButton } from '../alerts/BellButton';

export type ParentTab = 'home' | 'avatar' | 'sessions' | 'caregivers';

const ITEMS: TabItem<ParentTab>[] = [
  { key: 'home', label: 'Home', icon: '🏠' },
  { key: 'avatar', label: 'My Avatar', icon: '🪞' },
  { key: 'sessions', label: 'Sessions', icon: '💬' },
  { key: 'caregivers', label: 'Caregivers', icon: '👥' },
];

export const TAB_PATH: Record<ParentTab, string> = {
  home: '/parent',
  avatar: '/parent/avatar',
  sessions: '/parent/sessions',
  caregivers: '/parent/caregivers',
};

/** A parent tab screen: the alerts bell in the top bar and the shared TabBar (Home, My Avatar, Sessions, Caregivers) pinned under the content. */
export function ParentScreen({
  tab,
  title,
  bg,
  back,
  actions,
  children,
}: {
  tab: ParentTab;
  title?: string;
  bg?: 'cream' | 'sunGradient';
  back?: () => void;
  /** Top-bar actions. Defaults to the alerts bell; pass null for none. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <Screen
      title={title}
      back={back}
      actions={actions === undefined ? <BellButton /> : actions}
      bg={bg}
      footerPadded={false}
      footer={<TabBar items={ITEMS} value={tab} onChange={(t) => t !== tab && navigate(TAB_PATH[t], { replace: true })} />}
    >
      {children}
    </Screen>
  );
}
