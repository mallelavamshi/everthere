import { useState } from 'react';
import type { MeResponse } from '@everthere/shared';
import { Button, Sheet, toast } from '../../ui';
import { api, ApiError, friendlyMessage } from '../../lib/api';
import { haptics } from '../../lib/native';
import { holdSession } from '../../lib/sessionHold';
import { setDevice } from '../../lib/storage';
import { TABLET_MIN_WIDTH } from '../caregiver/SharedTabletPrompt';
import { useAuthOps } from './authOps';
import { friendlyClerkError } from './lib';
import { InlineError } from './Step';

type Persona = 'parent' | 'teacher';

export const DEMO_WAKING = 'The demo is waking up — try again in a moment';

export function demoErrorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.code === 'RATE_LIMITED' || e.code === 'NOT_FOUND' || e.code === 'RESTING' ? DEMO_WAKING : friendlyMessage(e.code);
  return friendlyClerkError(e).message;
}

const AS = (token: string | null): RequestInit => ({ headers: token ? { Authorization: `Bearer ${token}` } : {} });

/** "Try the demo": one tap signs a judge in as the seeded parent or teacher (a Clerk ticket from the API). */
export function TryDemoSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ops = useAuthOps();
  const [busy, setBusy] = useState<Persona | null>(null);
  const [failed, setFailed] = useState<{ persona: Persona; message: string } | null>(null);

  const go = async (persona: Persona) => {
    if (busy) return;
    setBusy(persona);
    setFailed(null);
    haptics.light();
    let release: () => void = () => {};
    const hold = new Promise<void>((r) => (release = r));
    try {
      const { ticket } = await api<{ ticket: string }>('/demo/sign-in', { method: 'POST', json: { persona } });
      // Only a tablet-sized screen becomes a classroom tablet; a phone stays a plain teacher view (the registration
      // would otherwise outlive the demo on this phone).
      const registerTablet = persona === 'teacher' && window.innerWidth >= TABLET_MIN_WIDTH;
      // The teacher's tablet registration has to land before the session screen picks a role: hold it until done.
      if (registerTablet) holdSession(hold);
      const { getToken } = await ops.ticketSignIn(ticket);
      if (registerTablet) {
        // Best effort: the teacher is signed in either way, and teacherOrgs alone already routes to the classroom.
        try {
          const token = await getToken();
          const me = await api<MeResponse>('/me', AS(token));
          const org = me.roles.teacherOrgs[0];
          if (org) {
            const { deviceId } = await api<{ deviceId: string }>(`/orgs/${encodeURIComponent(org.id)}/devices`, { method: 'POST', ...AS(token) });
            await setDevice({ orgId: org.id, deviceId });
          }
        } catch {
          toast.info("We couldn't set up this tablet just yet. You can do it later from your profile 💛");
        }
      }
      haptics.success();
    } catch (e) {
      haptics.error();
      setFailed({ persona, message: demoErrorMessage(e) });
    } finally {
      release();
      setBusy(null);
    }
  };

  return (
    <Sheet open={open} onClose={() => (busy ? undefined : onClose())} title="Try the demo ✨">
      <p className="mb-4 text-[15px] leading-snug text-mutedText">Look around a ready-made EverThere. No sign-up needed, and nothing you do here is saved to a real account.</p>
      <div className="flex flex-col gap-4 pb-2">
        <div className="flex flex-col gap-1.5">
          <Button size="lg" fullWidth variant="sun" loading={busy === 'parent'} disabled={busy !== null && busy !== 'parent'} onClick={() => void go('parent')}>
            Peek as a Parent 👩‍👧
          </Button>
          <p className="px-2 text-center text-[13px] text-mutedText">Meet a little one’s avatar and see a comfort call.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Button size="lg" fullWidth variant="white" loading={busy === 'teacher'} disabled={busy !== null && busy !== 'teacher'} onClick={() => void go('teacher')}>
            Peek as a Teacher 🍎
          </Button>
          <p className="px-2 text-center text-[13px] text-mutedText">See a classroom tablet, the roster and parent-set comfort plans.</p>
        </div>
        {failed ? <InlineError message={failed.message} onRetry={() => void go(failed.persona)} retrying={busy !== null} /> : null}
      </div>
    </Sheet>
  );
}
