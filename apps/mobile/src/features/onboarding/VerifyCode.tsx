import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Illustration, toast } from '../../ui';
import { haptics } from '../../lib/native';
import { CodeBoxes } from './CodeBoxes';
import { friendlyClerkError } from './lib';
import { InlineError, Step } from './Step';

const RESEND_SECONDS = 30;

export interface VerifyCodeProps {
  email: string;
  /** Throws (the raw Clerk error) when the code is wrong; resolving means signed in / verified. */
  onVerify: (code: string) => Promise<void>;
  onResend: () => Promise<void>;
  onBack: () => void;
  steps?: { total: number; current: number };
}

/** The styled 6-box email-code step, used by sign-up, new-device sign-in (client trust) and password reset. */
export function VerifyCode({ email, onVerify, onResend, onBack, steps }: VerifyCodeProps) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);
  const [resending, setResending] = useState(false);
  const live = useRef(true);
  const inflight = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const submit = useCallback(
    async (value: string) => {
      if (busy || inflight.current || value.length !== 6) return;
      inflight.current = true;
      setBusy(true);
      setError(null);
      setOffline(null);
      try {
        await onVerify(value);
        haptics.success();
      } catch (e) {
        if (!live.current) return;
        const f = friendlyClerkError(e);
        haptics.error();
        if (f.field === 'code') {
          setError(f.message);
          setCode('');
          setShake((n) => n + 1);
        } else {
          setOffline(f.message);
        }
      } finally {
        inflight.current = false;
        if (live.current) setBusy(false);
      }
    },
    [busy, onVerify],
  );

  const resend = async () => {
    setResending(true);
    try {
      await onResend();
      setCooldown(RESEND_SECONDS);
      setError(null);
      toast.success('A fresh code is on its way 💌');
    } catch (e) {
      setOffline(friendlyClerkError(e).message);
    } finally {
      if (live.current) setResending(false);
    }
  };

  return (
    <Step
      back={onBack}
      steps={steps}
      center
      hero={<Illustration asset="onboarding.invite" size={112} priority />}
      title="Check your email 💌"
      sub={
        <>
          We sent a 6-digit code to <b className="break-all font-semibold text-ink">{email}</b>.
        </>
      }
      footer={
        <div className="flex flex-col gap-2">
          <Button size="lg" fullWidth haptic loading={busy} disabled={code.length !== 6} onClick={() => void submit(code)}>
            Verify
          </Button>
          <Button variant="ghost" size="sm" fullWidth loading={resending} disabled={cooldown > 0} onClick={() => void resend()}>
            {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
          </Button>
        </div>
      }
    >
      <CodeBoxes
        mode="digits"
        label="Email code"
        value={code}
        shake={shake}
        error={error ?? undefined}
        disabled={busy}
        autoFocus
        onChange={(v) => {
          setCode(v);
          setError(null);
          if (v.length === 6) void submit(v);
        }}
      />
      {offline ? <InlineError message={offline} onRetry={code.length === 6 ? () => void submit(code) : undefined} /> : null}
      <p className="text-center text-[13px] text-mutedText">Can’t find it? Peek in your spam folder.</p>
    </Step>
  );
}
