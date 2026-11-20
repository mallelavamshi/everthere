import { useNavigate } from 'react-router-dom';
import { useAlerts } from '../../lib/queries';

/** The bell in the parent top bar: opens the alerts, with a badge for the unread ones. */
export function BellButton() {
  const navigate = useNavigate();
  const unread = useAlerts(true).data?.length ?? 0;
  return (
    <button
      type="button"
      aria-label={unread ? `Alerts, ${unread} unread` : 'Alerts'}
      onClick={() => navigate('/parent/alerts')}
      className="relative grid h-11 w-11 place-items-center rounded-full text-[22px] leading-none active:bg-ink/10"
    >
      <span aria-hidden="true">🔔</span>
      {unread ? (
        <span
          aria-hidden="true"
          className="absolute right-0.5 top-0.5 grid h-[20px] min-w-[20px] place-items-center rounded-full border-2 border-cream bg-danger px-1 text-[11px] font-bold leading-none text-white"
        >
          {unread > 9 ? '9+' : unread}
        </span>
      ) : null}
    </button>
  );
}
