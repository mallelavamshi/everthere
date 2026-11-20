import { Card, Illustration } from '../../ui';
import { plural } from './copy';

const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

/** This month's comfort calls, and what they cost so far. */
export function UsageCard({ monthSessions, monthCostUsd }: { monthSessions: number; monthCostUsd: number }) {
  return (
    <Card tone="white" aria-label="Usage this month" role="group">
      <div className="flex items-center gap-3">
        <Illustration asset="sticker.stars" size={52} alt="" />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-mutedText">Usage</p>
          <p className="text-[20px] font-bold leading-tight text-ink">{plural(monthSessions, 'session')} this month</p>
          <p className="text-[14px] text-mutedText">About {usd(monthCostUsd)} in call costs so far</p>
        </div>
      </div>
    </Card>
  );
}
