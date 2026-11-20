import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { startAlertsPoller, stopAlertsPoller } from '../lib/alertsPoller';
import { notificationPrimer, onNotificationTap, setPrimerAllowed, useNotificationPrimer } from '../lib/notifications';
import { Button, Sheet } from '../ui';
import { useSession } from './SessionContext';

/** The friendly "why" shown once, right before the first notification would appear and Android asks for permission. */
function NotificationPrimer() {
  const open = useNotificationPrimer();
  return (
    <Sheet
      open={open}
      onClose={() => notificationPrimer.answer(false)}
      title="Want a nudge when a call ends?"
      footer={
        <div className="flex flex-col gap-2">
          <Button fullWidth onClick={() => notificationPrimer.answer(true)}>
            Turn on nudges
          </Button>
          <Button variant="ghost" fullWidth onClick={() => notificationPrimer.answer(false)}>
            Not now
          </Button>
        </div>
      }
    >
      <p className="text-[16px] leading-relaxed">
        We can tell you the moment your little one&apos;s summary is ready, or if something is worth a look. Android will ask you to allow it next.
      </p>
      <p className="mt-2 text-[14px] text-mutedText">Either way, the bell in the app always shows what&apos;s new.</p>
    </Sheet>
  );
}

/**
 * Signed-in plumbing for alerts: polls while the app is in the foreground (parents on their own phone, not a shared
 * classroom tablet) and opens the right screen when a notification is tapped.
 */
export function AlertsBridge() {
  const { me, roles, device } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Quiet during a live comfort call: nothing may pop over it. Polling picks up again (straight away) when it ends.
  const { pathname } = useLocation();
  const inCall = pathname.startsWith('/live');
  const polls = roles.includes('parent') && !device && !inCall;
  const userId = me.user.id;

  useEffect(() => {
    if (!polls) return;
    startAlertsPoller(userId, qc);
    return stopAlertsPoller;
  }, [polls, userId, qc]);

  // The permission sheet only on Home, Sessions and Alerts.
  const calm = /^\/parent(\/(sessions|alerts)(\/[^/]+)?)?\/?$/.test(pathname);
  useEffect(() => setPrimerAllowed(calm), [calm]);

  useEffect(() => onNotificationTap((path) => navigate(path)), [navigate]);

  return <NotificationPrimer />;
}
