import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { MeResponse } from '@everthere/shared';
import { Avatar, Button, Card, Illustration, Skeleton } from '../../ui';
import { api, ApiError, friendlyMessage } from '../../lib/api';
import { haptics } from '../../lib/native';
import { qk, useChildren } from '../../lib/queries';
import { homeFor } from '../../lib/role';
import { clearStashedCode, readStashedCode, stashCode } from '../../lib/pendingCode';
import { getDevice, setRolePref, type RolePref } from '../../lib/storage';
import { CodeBoxes } from './CodeBoxes';
import { normalizeCode } from './lib';
import { PinPad } from './PinPad';
import { InlineError, Step, useOnbPath } from './Step';

type InviteType = 'staff' | 'parent_enrollment' | 'co_parent' | 'home_caregiver';
interface Peek {
  type: InviteType;
  orgName?: string;
  childName?: string;
  inviterName: string;
}

type Stage = 'code' | 'auth' | 'invite' | 'pin' | 'pick';

export const CODE_DIDNT_WORK = "That code didn't work. Double-check it, or ask for a fresh one 💛";
const ROLE_FOR: Record<InviteType, RolePref> = { staff: 'caregiver', parent_enrollment: 'parent', co_parent: 'parent', home_caregiver: 'caregiver' };

function inviteCopy(i: Peek): { title: string; body: string; cta: string } {
  const org = i.orgName?.trim();
  const who = i.inviterName?.trim();
  switch (i.type) {
    case 'staff':
      return {
        title: org ? `${org} invited you to join as a teacher` : 'You’re invited to join as a teacher',
        body: who ? `${who} set this up for you. Next, you'll pick a PIN for the classroom tablet.` : "Next, you'll pick a PIN for the classroom tablet.",
        cta: 'Accept invite 💛',
      };
    case 'parent_enrollment':
      return {
        title: org ? `${org} invited you to connect with ${i.childName ?? 'your little one'}` : `You’re invited to connect with ${i.childName ?? 'your little one'}`,
        body: 'Once you are in, you can add your face and voice so they feel you close, even in the classroom.',
        cta: 'Accept invite 💛',
      };
    case 'co_parent':
      return {
        title: who ? `${who} invited you to be a co-parent` : 'You’re invited to be a co-parent',
        body: 'You will share your little one’s comfort plan and see their sessions together.',
        cta: 'Accept invite 💛',
      };
    case 'home_caregiver':
      return {
        title: who ? `${who} invited you to help care for their little one` : 'You’re invited to help care for a little one',
        body: 'You will be able to start a comfort call when they need a familiar face.',
        cta: 'Accept invite 💛',
      };
  }
}

/** Which of my own children could this enrollment be? Loading and error states included. */
function ChildPicker({ childName, onPick, busy }: { childName: string; onPick: (childId?: string) => void; busy: boolean }) {
  const q = useChildren();
  const own = (q.data ?? []).filter((c) => c.familyId !== undefined);
  return (
    <>
      {q.isPending ? (
        <div className="flex flex-col gap-3" role="status" aria-label="Loading your children">
          <Skeleton shape="card" count={2} />
        </div>
      ) : q.isError ? (
        <InlineError message={q.error instanceof ApiError ? friendlyMessage(q.error.code) : friendlyMessage('INTERNAL')} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : (
        own.map((c) => (
          <Card key={c.id} lift tone="white" onClick={() => !busy && onPick(c.id)} aria-label={`${c.name}, yes this is my child`} className="flex min-h-[64px] items-center gap-3 px-4 py-2">
            <Avatar name={c.name} size={44} />
            <span className="text-[18px] font-semibold">{c.name}</span>
          </Card>
        ))
      )}
      <Button size="lg" fullWidth variant="sun" haptic loading={busy} disabled={q.isPending} onClick={() => onPick(undefined)}>
        {`Add ${childName} as new`}
      </Button>
    </>
  );
}

/**
 * Join with an invite code. Signed out: asks for sign-up/sign-in first and carries the code through it in the URL
 * (the code waits in sessionStorage, never in the URL). Signed in: peek, a friendly card, then the type's own step, then redeem.
 */
export function Join({ signedIn }: { signedIn: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const p = useOnbPath();
  const [code, setCode] = useState(() => readStashedCode());
  // In-flight latches: state updates are async, so a second tap in the same tick must not start a second request.
  const flight = useRef({ peek: false, redeem: false });
  const [stage, setStage] = useState<Stage>('code');
  const [invite, setInvite] = useState<Peek | null>(null);
  const [busy, setBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [problem, setProblem] = useState<{ message: string; retry?: () => void } | null>(null);
  // PIN
  const [pinPhase, setPinPhase] = useState<'set' | 'confirm'>('set');
  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinShake, setPinShake] = useState(0);

  const badCode = () => {
    haptics.error();
    setStage('code');
    setCodeError(CODE_DIDNT_WORK);
    setShake((n) => n + 1);
  };

  const submitCode = async () => {
    if (code.length !== 6 || busy || flight.current.peek) return;
    if (!signedIn) {
      stashCode(code);
      setStage('auth');
      return;
    }
    flight.current.peek = true;
    setBusy(true);
    setProblem(null);
    setCodeError(null);
    try {
      const peek = await api<Peek>('/invites/peek', { method: 'POST', json: { code } });
      haptics.success();
      setInvite(peek);
      setStage('invite');
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'INVITE_INVALID' || e.code === 'NOT_FOUND')) badCode();
      else setProblem({ message: e instanceof ApiError ? friendlyMessage(e.code) : friendlyMessage('INTERNAL'), retry: () => void submitCode() });
    } finally {
      flight.current.peek = false;
      setBusy(false);
    }
  };

  const redeem = async (extra: { existingChildId?: string; pin?: string } = {}) => {
    if (!invite || busy || flight.current.redeem) return;
    flight.current.redeem = true;
    setBusy(true);
    setProblem(null);
    try {
      await api('/invites/redeem', { method: 'POST', json: { code, ...extra } });
      clearStashedCode();
      await setRolePref(ROLE_FOR[invite.type]);
      await qc.invalidateQueries();
      const me = await qc.fetchQuery({ queryKey: qk.me(), queryFn: () => api<MeResponse>('/me'), staleTime: 0 });
      const device = await getDevice();
      haptics.success();
      navigate(homeFor(me, ROLE_FOR[invite.type], { device }), { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INVITE_INVALID') {
        badCode();
      } else {
        haptics.error();
        setProblem({ message: e instanceof ApiError ? friendlyMessage(e.code) : friendlyMessage('INTERNAL'), retry: () => void redeem(extra) });
      }
      if (stage === 'pin') {
        setPinPhase('set');
        setPin('');
        setFirstPin('');
      }
    } finally {
      flight.current.redeem = false;
      setBusy(false);
    }
  };

  const goBack = () => {
    setProblem(null);
    if (stage === 'code') navigate(-1);
    else if (stage === 'pin' || stage === 'pick') setStage('invite');
    else setStage('code');
  };

  // ---- signed out: sign up or sign in first, then come back to this code ----
  if (stage === 'auth') {
    const back = encodeURIComponent(p('/join'));
    return (
      <Step
        key="auth"
        back={goBack}
        center
        hero={<Illustration asset="onboarding.invite" size={140} priority />}
        title="Almost there! 💛"
        sub="Create your account, or sign in, so your invite is saved to you. We'll keep your code safe."
        footer={
          <div className="flex flex-col gap-3">
            <Button size="lg" fullWidth haptic onClick={() => navigate(`${p('/signup')}?next=${back}`)}>
              Create my account
            </Button>
            <Button size="lg" fullWidth variant="white" haptic onClick={() => navigate(`${p('/signin')}?next=${back}`)}>
              I already have an account
            </Button>
          </div>
        }
      >
        <div className="mx-auto rounded-full border-2 border-ink bg-white px-5 py-2 text-[20px] font-semibold tracking-[0.25em]" aria-label={`Your code is ${code.split('').join(' ')}`}>
          {code}
        </div>
      </Step>
    );
  }

  // ---- the invite card ----
  if (stage === 'invite' && invite) {
    const copy = inviteCopy(invite);
    const onAccept = () => {
      if (invite.type === 'staff') setStage('pin');
      else if (invite.type === 'parent_enrollment') setStage('pick');
      else void redeem();
    };
    return (
      <Step
        key="invite"
        back={goBack}
        center
        hero={<Illustration asset="onboarding.invite" size={156} priority />}
        title={copy.title}
        sub={copy.body}
        footer={
          <Button size="lg" fullWidth haptic loading={busy} onClick={onAccept}>
            {copy.cta}
          </Button>
        }
      >
        {problem ? <InlineError message={problem.message} onRetry={problem.retry} retrying={busy} /> : null}
      </Step>
    );
  }

  // ---- staff: choose a PIN, twice ----
  if (stage === 'pin' && invite) {
    const onPin = (v: string) => {
      if (pinPhase === 'set') {
        setFirstPin(v);
        setPin('');
        setPinPhase('confirm');
        setPinError(null);
      } else if (v === firstPin) {
        void redeem({ pin: v });
      } else {
        haptics.error();
        setPinError("PINs don't match");
        setPinShake((n) => n + 1);
        setPin('');
        setFirstPin('');
        setPinPhase('set');
      }
    };
    return (
      <Step
        key={`pin-${pinPhase}`}
        back={goBack}
        center
        title={pinPhase === 'set' ? 'Create your classroom PIN' : 'One more time'}
        sub={pinPhase === 'set' ? "Pick 4 digits only you will know. You'll use them on the shared classroom tablet." : 'Enter the same 4 digits again to be sure.'}
      >
        <div className="flex flex-col items-center gap-4">
          <p role={pinError ? 'alert' : undefined} className="min-h-[24px] text-center text-[15px] font-semibold text-danger">
            {pinError}
          </p>
          <PinPad
            value={pin}
            shake={pinShake}
            disabled={busy}
            label={pinPhase === 'set' ? 'New PIN' : 'Confirm PIN'}
            onChange={(v) => {
              setPin(v);
              if (pinError) setPinError(null);
            }}
            onComplete={onPin}
          />
          {busy ? <p className="text-[14px] text-mutedText">Joining {invite.orgName ?? 'your classroom'}…</p> : null}
          {problem ? <InlineError message={problem.message} onRetry={problem.retry} retrying={busy} /> : null}
        </div>
      </Step>
    );
  }

  // ---- parent enrollment: is this one of your children? ----
  if (stage === 'pick' && invite) {
    const childName = invite.childName ?? 'your little one';
    return (
      <Step key="pick" back={goBack} title="Is this one of your children?" sub={`${invite.orgName ?? 'Your daycare'} added ${childName}. Pick the match, or add them as new.`}>
        <ChildPicker childName={childName} busy={busy} onPick={(id) => void redeem(id ? { existingChildId: id } : {})} />
        {problem ? <InlineError message={problem.message} onRetry={problem.retry} retrying={busy} /> : null}
      </Step>
    );
  }

  // ---- code entry ----
  return (
    <Step
      key="code"
      back={goBack}
      center
      hero={<Illustration asset="onboarding.invite" size={132} priority />}
      title="Got an invite code?"
      sub="Enter the 6-character code from your daycare or family."
      footer={
        <Button size="lg" fullWidth haptic loading={busy} disabled={code.length !== 6} onClick={() => void submitCode()}>
          Continue
        </Button>
      }
    >
      <CodeBoxes
        label="Invite code"
        value={code}
        shake={shake}
        error={codeError ?? undefined}
        disabled={busy}
        autoFocus
        onChange={(v) => {
          setCode(v);
          setCodeError(null);
        }}
      />
      {problem ? <InlineError message={problem.message} onRetry={problem.retry} retrying={busy} /> : null}
      <p className="text-center text-[13px] text-mutedText">Tip: you can paste the code, we'll fill in all the boxes.</p>
    </Step>
  );
}
