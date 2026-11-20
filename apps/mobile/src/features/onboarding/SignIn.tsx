import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Field, Illustration } from '../../ui';
import { haptics } from '../../lib/native';
import { useAuthOps } from './authOps';
import { useAuthTarget } from './flow';
import { friendlyClerkError, isEmail, scrollIntoViewSoon, type ClerkField } from './lib';
import { PasswordField } from './SignUp';
import { InlineError, Step, useOnbPath } from './Step';
import { VerifyCode } from './VerifyCode';

export function SignIn() {
  const ops = useAuthOps();
  const navigate = useNavigate();
  const p = useOnbPath();
  const { dest, carry } = useAuthTarget();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [fieldErr, setFieldErr] = useState<Partial<Record<ClerkField, string>>>({});
  const [general, setGeneral] = useState<string | null>(null);

  const ready = isEmail(email) && password.length > 0;

  // A new device: Clerk wants a code emailed to the person before it trusts it ("client trust").
  if (verifying) {
    return (
      <VerifyCode
        email={email.trim()}
        onBack={() => setVerifying(false)}
        onResend={() => ops.resendSignIn()}
        onVerify={async (code) => {
          await ops.verifySignIn(code);
          navigate(dest, { replace: true });
        }}
      />
    );
  }

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setGeneral(null);
    setFieldErr({});
    try {
      const outcome = await ops.signIn({ email: email.trim(), password });
      haptics.success();
      if (outcome === 'complete') navigate(dest, { replace: true });
      else setVerifying(true);
    } catch (err) {
      const f = friendlyClerkError(err);
      haptics.error();
      if (f.field === 'email' || f.field === 'password') setFieldErr({ [f.field]: f.message });
      else setGeneral(f.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Step
      back={() => navigate(-1)}
      hero={<Illustration asset="brand.icon" size={88} priority />}
      title="Welcome back 👋"
      sub="Sign in to pick up where you left off."
      footer={
        <div className="flex flex-col gap-1">
          <Button type="submit" form="signin-form" size="lg" fullWidth haptic loading={busy} disabled={!ready}>
            Sign in
          </Button>
          <Button variant="ghost" size="sm" fullWidth onClick={() => navigate(p('/signup') + carry(), { replace: true })}>
            New here? Create an account
          </Button>
        </div>
      }
    >
      <form id="signin-form" onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
        <Field
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          enterKeyHint="next"
          value={email}
          error={fieldErr.email}
          onChange={(e) => {
            setEmail(e.target.value);
            setFieldErr({});
          }}
          onFocus={(e) => scrollIntoViewSoon(e.currentTarget)}
        />
        <PasswordField
          value={password}
          autoComplete="current-password"
          showRules={false}
          error={fieldErr.password}
          onChange={(v) => {
            setPassword(v);
            setFieldErr({});
          }}
        />
        <Button variant="ghost" size="sm" className="-mt-2 self-start" onClick={() => navigate(p('/forgot'))}>
          Forgot your password?
        </Button>
        {general ? <InlineError message={general} /> : null}
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </form>
    </Step>
  );
}
