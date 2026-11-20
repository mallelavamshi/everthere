import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { OrgView } from '@everthere/shared';
import { api, ApiError, friendlyMessage } from '../../lib/api';
import { downscaleForUpload } from '../../lib/image';
import { haptics } from '../../lib/native';
import { pickPhoto } from '../../lib/pickPhoto';
import { qk } from '../../lib/queries';
import { Avatar, Button, ErrorState, Field, Screen, Skeleton, toast } from '../../ui';
import { uploadMedia } from '../avatar/avatarApi';
import { TimezonePicker } from '../onboarding/TimezonePicker';
import { useAdminOrg } from './useAdminOrg';

const errCode = (e: unknown) => (e instanceof ApiError ? e.code : 'INTERNAL');

function Form({ org, isDemo }: { org: OrgView; isDemo: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState(org.name);
  const [address, setAddress] = useState(org.address ?? '');
  const [timezone, setTimezone] = useState(org.timezone);
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const logoFlight = useRef(false);

  const put = (next: OrgView) => qc.setQueryData(qk.org(org.id), next);

  // Only what changed is sent: a demo account (which cannot rename) can still correct an address.
  const patch: Record<string, string> = {};
  if (!isDemo && name.trim() !== org.name) patch.name = name.trim();
  if (address.trim() !== (org.address ?? '')) patch.address = address.trim();
  if (timezone !== org.timezone) patch.timezone = timezone;
  const dirty = Object.keys(patch).length > 0 && (isDemo || name.trim().length > 0);

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!dirty || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      put(await api<OrgView>(`/orgs/${encodeURIComponent(org.id)}`, { method: 'PATCH', json: patch }));
      void qc.invalidateQueries({ queryKey: qk.me() }); // the org's name is also in the signed-in profile
      haptics.success();
      toast.success('Saved 💛');
    } catch (err) {
      haptics.error();
      setError(friendlyMessage(errCode(err)));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const setLogo = async (kind: 'camera' | 'gallery' | 'remove') => {
    if (logoFlight.current) return;
    logoFlight.current = true;
    setLogoBusy(true);
    try {
      let logoKey: string | null = null;
      if (kind !== 'remove') {
        const photo = kind === 'camera' ? await pickPhoto('camera', { rear: true }) : await pickPhoto('gallery');
        if (!photo) return; // backed out
        const small = await downscaleForUpload(photo);
        logoKey = (await uploadMedia(small, 'logo', 'logo.jpg', { orgId: org.id })).key;
      }
      put(await api<OrgView>(`/orgs/${encodeURIComponent(org.id)}`, { method: 'PATCH', json: { logoKey } }));
      haptics.success();
      toast.success(kind === 'remove' ? 'Logo removed' : 'Logo updated ✓');
    } catch (err) {
      haptics.error();
      toast.error(friendlyMessage(errCode(err)));
    } finally {
      logoFlight.current = false;
      setLogoBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-5 pb-4">
      <section aria-label="Logo" className="flex flex-col items-center gap-3 text-center">
        {/* The signed URL expires (1 hour): Avatar falls back to the initial rather than a broken image. */}
        <Avatar src={org.logoUrl ?? undefined} name={`${org.name} logo`} size={112} ring />
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" variant="white" loading={logoBusy} onClick={() => void setLogo('camera')}>
            Take a photo
          </Button>
          <Button size="sm" variant="white" disabled={logoBusy} onClick={() => void setLogo('gallery')}>
            Choose from gallery
          </Button>
          {org.logoKey ? (
            <Button size="sm" variant="ghost" disabled={logoBusy} onClick={() => void setLogo('remove')}>
              Remove logo
            </Button>
          ) : null}
        </div>
      </section>

      <form onSubmit={(e) => void save(e)} noValidate className="flex flex-col gap-4">
        <Field
          label="Daycare name"
          value={name}
          maxLength={80}
          disabled={isDemo}
          hint={isDemo ? 'View only: the demo account can’t rename the daycare.' : undefined}
          autoCapitalize="words"
          enterKeyHint="next"
          onChange={(e) => setName(e.target.value)}
        />
        <Field label="Address" value={address} maxLength={200} autoComplete="street-address" autoCapitalize="words" enterKeyHint="done" onChange={(e) => setAddress(e.target.value)} />
        <TimezonePicker value={timezone} onChange={setTimezone} />
        {error ? (
          <p role="alert" className="rounded-card bg-flag p-3 text-[14px]">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" fullWidth loading={saving} disabled={!dirty}>
          Save
        </Button>
      </form>
    </div>
  );
}

/** Edit the daycare's name, address, time zone and logo. Reached from the dashboard header. */
export function DaycareProfile() {
  const navigate = useNavigate();
  const { org, isDemo } = useAdminOrg();
  return (
    <Screen title="Daycare profile" back={() => navigate('/admin', { replace: true })}>
      {org.isPending ? (
        <Skeleton shape="card" count={3} />
      ) : org.isError || !org.data ? (
        <ErrorState onRetry={() => void org.refetch()} retrying={org.isFetching} />
      ) : (
        // Keyed by id so the form starts from the saved values, then owns them while it is open.
        <Form key={org.data.id} org={org.data} isDemo={isDemo} />
      )}
    </Screen>
  );
}
