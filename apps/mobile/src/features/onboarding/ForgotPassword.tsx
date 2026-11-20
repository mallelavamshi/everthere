import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Field, Illustration } from '../../ui';
import { haptics } from '../../lib/native';
import { useAuthOps } from './authOps';
import { friendlyClerkError, isEmail, passwordChecks, scrollIntoViewSoon } from './lib';
import { PasswordField } from './SignUp';
import { InlineError, Step } from './Step';
import { VerifyCode } from './VerifyCode';

type Stage = 'email' | 'code' | 'password';

/** Forgot password: email -> 6-box code -> new password -> signed in. */
export function ForgotPassword() {
  const ops = useAuthOps();
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>, after: () => void) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      haptics.success();
      after();
    } catch (err) {
      haptics.error();
      setError(friendlyClerkError(err).message);
    } finally {
      setBusy(false);
    }
  };

  if (stage === 'code') {
    return (
      <VerifyCode
        email={email.trim()}
        onBack={() => setStage('email')}
        onResend={() => ops.sendReset(email.trim())}
        onVerify={async (code) => {
          await ops.verifyReset(code);
          setStage('password');
        }}
      />
    );
  }

  if (stage === 'password') {
    const ok = passwordChecks(password).every((c) => !c.required || c.ok);
    return (
      <Step
        title="Choose a new password"
        sub="Something you'll remember. Make it a good one 🔑"
        hero={<Illustration asset="onboarding.avatarConsent" size={96} priority />}
        footer={
          <Button size="lg" fullWidth haptic loading={busy} disabled={!ok} onClick={() => void run(() => ops.submitReset(password), () => navigate('/', { replace: true }))}>
            Save and sign in
          </Button>
        }
      >
        <PasswordField label="New password" value={password} onChange={setPassword} />
        {error ? <InlineError message={error} /> : null}
      </Step>
    );
  }

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    if (!isEmail(email)) return;
    void run(() => ops.sendReset(email.trim()), () => setStage('code'));
  };

  return (
    <Step
      back={() => navigate(-1)}
      title="Forgot your password?"
      sub="No worries. We'll email you a code to set a new one."
      hero={<Illustration asset="onboarding.invite" size={96} priority />}
      footer={
        <Button type="submit" form="forgot-form" size="lg" fullWidth haptic loading={busy} disabled={!isEmail(email)}>
          Send me a code
        </Button>
      }
    >
      <form id="forgot-form" onSubmit={send} noValidate className="flex flex-col gap-4">
        <Field
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onFocus={(e) => scrollIntoViewSoon(e.currentTarget)}
        />
        {error ? <InlineError message={error} /> : null}
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </form>
    </Step>
  );
}
