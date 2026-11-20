import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError, friendlyMessage } from '../../lib/api';
import { getTabletAsked, setTabletAsked } from '../../lib/storage';
import { Button, Illustration, Sheet, toast } from '../../ui';
import { useSession } from '../../shell/SessionContext';

/** Narrower than this is a phone: a classroom tablet is never asked about. */
export const TABLET_MIN_WIDTH = 700;

/**
 * "Is this a shared classroom tablet?", asked once per device: when staff (teacher or admin) sign in on a wide screen
 * that has no registration yet. Yes registers the device with the org; No (or closing) is remembered and never asked again.
 */
export function SharedTabletPrompt() {
  const { me, device, registerDevice } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [asked, setAsked] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const orgId = me.roles.teacherOrgs[0]?.id ?? me.roles.adminOrgs[0]?.id;

  useEffect(() => {
    let live = true;
    void getTabletAsked().then((a) => live && setAsked(a));
    return () => {
      live = false;
    };
  }, []);

  const eligible =
    asked === false && !device && !!orgId && !me.user.isDemo && typeof window !== 'undefined' && window.innerWidth >= TABLET_MIN_WIDTH && !/^\/(live|onboarding)(\/|$)/.test(pathname);

  const answer = async (shared: boolean) => {
    if (!orgId || busy) return;
    if (!shared) {
      void setTabletAsked();
      setAsked(true);
      return;
    }
    setBusy(true);
    try {
      const { deviceId } = await api<{ deviceId: string }>(`/orgs/${encodeURIComponent(orgId)}/devices`, { method: 'POST' });
      await setTabletAsked();
      setAsked(true);
      registerDevice({ orgId, deviceId });
      toast.success('Classroom tablet ready 🍎');
      navigate('/caregiver', { replace: true });
    } catch (e) {
      toast.error(friendlyMessage(e instanceof ApiError ? e.code : 'INTERNAL'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={eligible} onClose={() => void answer(false)} title="Is this a shared classroom tablet?">
      <div className="flex flex-col items-center gap-4 pb-2 text-center">
        <Illustration asset="blob.caregiver" size={160} />
        <p className="max-w-[28rem] text-[15px] leading-relaxed text-mutedText">
          If yes, each teacher can switch in with their own PIN, so every check-in shows who was with the child. You can still use your own account any time.
        </p>
        <div className="flex w-full flex-col gap-3 min-[480px]:flex-row">
          <Button size="lg" fullWidth loading={busy} haptic onClick={() => void answer(true)}>
            Yes, it's shared
          </Button>
          <Button size="lg" variant="white" fullWidth disabled={busy} onClick={() => void answer(false)}>
            No, just mine
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
