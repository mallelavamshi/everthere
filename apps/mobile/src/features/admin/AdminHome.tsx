import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DashboardView } from '@everthere/shared';
import type { AssetKey } from '../../assets/manifest';
import { api, ApiError, friendlyMessage } from '../../lib/api';
import { haptics } from '../../lib/native';
import { qk, useDashboard } from '../../lib/queries';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Illustration, Skeleton, toast, type CardTone } from '../../ui';
import { AdminScreen } from './AdminScreen';
import { CATEGORY_LABEL, SEVERITY, ago, plural } from './copy';
import { UsageCard } from './UsageCard';
import { useAdminOrg } from './useAdminOrg';

type Flag = DashboardView['openFlags'][number];

function Stat({ value, label, spoken, sticker, tone }: { value: number; label: string; spoken: string; sticker: AssetKey; tone: CardTone }) {
  return (
    <Card tone={tone} role="group" aria-label={`${value} ${spoken}`} className="flex flex-col items-center gap-0.5 px-2 py-3 text-center">
      <Illustration asset={sticker} size={44} alt="" />
      <span aria-hidden="true" className="text-[30px] font-bold leading-none">
        {value}
      </span>
      <span aria-hidden="true" className="text-[12px] font-medium leading-tight text-ink/80">
        {label}
      </span>
    </Card>
  );
}

/** Same teaser look as the voice teaser in the avatar flow: a lilac card with a sticker, display only. */
function BillingTeaser() {
  return (
    <div className="flex min-h-[72px] items-center gap-3 rounded-card bg-lilac px-4 py-3">
      <Illustration asset="sticker.rainbow" size={48} alt="" />
      <div className="flex flex-col">
        <span className="text-[16px] font-semibold leading-tight">Billing</span>
        <span className="text-[13px] text-mutedText">Families pay $9/mo add-on — billing coming with launch</span>
      </div>
    </div>
  );
}

function FlagRow({ flag, onAck }: { flag: Flag; onAck: (f: Flag) => void }) {
  const sev = SEVERITY[flag.severity] ?? SEVERITY.low;
  const category = CATEGORY_LABEL[flag.category] ?? CATEGORY_LABEL.other;
  const name = flag.childName || 'A little one';
  return (
    <li aria-label={`${name}, ${category}`} className="rounded-card border-card border-coral bg-flag p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[17px] font-semibold leading-tight">{name}</span>
        <Badge tone="neutral">{category}</Badge>
        <Badge tone={sev.tone}>{sev.label}</Badge>
        <span className="ml-auto text-[12px] text-mutedText">{ago(flag.createdAt)}</span>
      </div>
      {flag.quote ? <p className="mt-2 text-[15px] italic leading-snug">“{flag.quote}”</p> : null}
      <div className="mt-2 flex justify-end">
        <Button size="sm" variant="white" aria-label={`Acknowledge flag for ${name}`} onClick={() => onAck(flag)}>
          Acknowledge
        </Button>
      </div>
    </li>
  );
}

/** Dashboard tab: the numbers, what needs a look, usage and the billing teaser. Two columns on a tablet, one on a phone. */
export function AdminHome() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { orgId, orgName, org } = useAdminOrg();
  const dash = useDashboard(orgId);
  const key = qk.dashboard(orgId ?? '');

  // Optimistic: the flag leaves the list at once; if the server says no it goes back where it was.
  const ack = useMutation({
    mutationFn: (flag: Flag) => api(`/flags/${encodeURIComponent(flag.id)}/ack`, { method: 'POST' }),
    onMutate: async (flag) => {
      await qc.cancelQueries({ queryKey: key });
      const index = qc.getQueryData<DashboardView>(key)?.openFlags.findIndex((f) => f.id === flag.id) ?? -1;
      qc.setQueryData<DashboardView>(key, (d) => d && { ...d, openFlags: d.openFlags.filter((f) => f.id !== flag.id) });
      return { index };
    },
    onError: (e, flag, ctx) => {
      qc.setQueryData<DashboardView>(key, (d) => {
        if (!d || d.openFlags.some((f) => f.id === flag.id)) return d;
        const at = Math.min(Math.max(ctx?.index ?? 0, 0), d.openFlags.length);
        return { ...d, openFlags: [...d.openFlags.slice(0, at), flag, ...d.openFlags.slice(at)] };
      });
      haptics.error();
      toast.error(friendlyMessage(e instanceof ApiError ? e.code : 'INTERNAL'));
    },
    onSuccess: () => {
      haptics.success();
      toast.success('Flag acknowledged ✓');
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  });

  const d = dash.data;
  return (
    <AdminScreen tab="dashboard" title={orgName}>
      <div className="relative">
        {/* Soft sky blob behind the top of the page. */}
        <Illustration asset="blob.admin" size={440} alt="" className="pointer-events-none absolute -right-24 -top-16 opacity-60" />
        <div className="relative flex flex-col gap-4 pb-2">
          <button
            type="button"
            onClick={() => navigate('/admin/profile')}
            aria-label="Daycare profile"
            className="flex min-h-[56px] items-center gap-3 self-start rounded-full bg-white/80 py-1 pl-1 pr-4 text-left"
          >
            <Avatar src={org.data?.logoUrl ?? undefined} name={`${orgName} logo`} size={44} />
            <span className="flex flex-col">
              <span className="text-[15px] font-semibold leading-tight">{orgName}</span>
              <span className="text-[12px] text-mutedText">Daycare profile ›</span>
            </span>
          </button>

          {dash.isPending ? (
            <Skeleton shape="card" count={3} />
          ) : dash.isError || !d ? (
            <ErrorState onRetry={() => void dash.refetch()} retrying={dash.isFetching} />
          ) : (
            <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-2 min-[900px]:items-start">
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-3 gap-2">
                  <Stat value={d.readyCount} label="avatars ready" spoken="avatars ready" sticker="sticker.heart" tone="mint" />
                  <Stat value={d.todaySessions} label="sessions today" spoken="sessions today" sticker="sticker.sun" tone="sun" />
                  <Stat value={d.monthSessions} label="this month" spoken="sessions this month" sticker="sticker.cloud" tone="sky" />
                </div>

                <section aria-labelledby="flags-h" className="flex flex-col gap-2">
                  <h2 id="flags-h" className="text-[19px] font-bold">
                    Open flags
                  </h2>
                  {d.openFlags.length === 0 ? (
                    <EmptyState asset="empty.noAlerts" size={96} title="All calm 🌈" body="Nothing needs a look right now." />
                  ) : (
                    <ul className="flex flex-col gap-2" aria-label={plural(d.openFlags.length, 'open flag')}>
                      {d.openFlags.map((f) => (
                        <FlagRow key={f.id} flag={f} onAck={(x) => ack.mutate(x)} />
                      ))}
                    </ul>
                  )}
                </section>
              </div>

              <div className="flex flex-col gap-4">
                <UsageCard monthSessions={d.monthSessions} monthCostUsd={d.monthCostUsd} />
                <BillingTeaser />
                <Button variant="white" fullWidth icon="🖥️" onClick={() => navigate('/caregiver')}>
                  Open classroom tablet view
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminScreen>
  );
}
