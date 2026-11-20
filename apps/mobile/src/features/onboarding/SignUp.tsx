import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Button, Card, Field, Illustration } from '../../ui';
import { haptics } from '../../lib/native';
import { useAuthOps } from './authOps';
import { useAuthTarget } from './flow';
import { friendlyClerkError, isEmail, passwordChecks, scrollIntoViewSoon, type ClerkField } from './lib';
import { InlineError, Step, useOnbPath } from './Step';
import { VerifyCode } from './VerifyCode';

/** Password field with a show/hide toggle and the friendly rule list. Shared by sign-up and password reset. */
export function PasswordField({
  value,
  onChange,
  error,
  label = 'Password',
  autoComplete = 'new-password',
  showRules = true,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
  label?: string;
  autoComplete?: string;
  showRules?: boolean;
}) {
  const [show, setShow] = useState(false);
  const checks = passwordChecks(value);
  return (
    <div className="flex flex-col gap-2">
      <Field
        label={label}
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        enterKeyHint="done"
        value={value}
        error={error}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => scrollIntoViewSoon(e.currentTarget)}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-pressed={show}
        className="-mt-1 flex min-h-[44px] w-fit items-center gap-1.5 rounded-btn px-1 text-[14px] font-medium text-mutedText"
      >
        <span aria-hidden="true">{show ? '🙈' : '👀'}</span>
        <span>{show ? 'Hide password' : 'Show password'}</span>
      </button>
      {showRules ? (
        <ul aria-live="polite" className="-mt-1 flex flex-col gap-1">
          {checks.map((c) => (
            <li key={c.id} className={clsx('flex items-start gap-2 text-[14px]', c.ok ? 'text-mintInk' : 'text-mutedText')}>
              <span aria-hidden="true" className="w-4 text-center">
                {c.ok ? '✓' : '○'}
              </span>
              <span>
                {c.label}
                <span className="sr-only">{c.ok ? ', done' : c.required ? ', needed' : ', optional'}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function SignUp() {
  const ops = useAuthOps();
  const navigate = useNavigate();
  const p = useOnbPath();
  const { door, dest, carry } = useAuthTarget();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [fieldErr, setFieldErr] = useState<Partial<Record<ClerkField, string>>>({});
  const [general, setGeneral] = useState<string | null>(null);
  // An unfinished sign-up Clerk still holds (the app was killed mid sign-up): offer to carry on with it.
  const [resume, setResume] = useState(() => ops.pendingSignUp?.() ?? null);
  const [resumeEmail, setResumeEmail] = useState<string | null>(null);

  const lengthOk = passwordChecks(password).every((c) => !c.required || c.ok);
  const ready = first.trim() !== '' && last.trim() !== '' && isEmail(email) && lengthOk;
  const steps = door ? { total: 3, current: 1 } : undefined;
  const clearErr = (k: ClerkField) => setFieldErr((e) => (e[k] ? { ...e, [k]: undefined } : e));

  if (verifying) {
    return (
      <VerifyCode
        email={resumeEmail ?? email.trim()}
        steps={steps}
        onBack={() => {
          setVerifying(false);
          setResumeEmail(null);
        }}
        onResend={() => ops.resendSignUp()}
        onVerify={async (code) => {
          await ops.verifySignUp(code);
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
      const outcome = await ops.signUp({ firstName: first.trim(), lastName: last.trim(), email: email.trim(), password });
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

  const continueSignUp = async () => {
    if (!resume || busy) return;
    setBusy(true);
    setGeneral(null);
    try {
      const outcome = await ops.resumeSignUp!();
      if (outcome === 'complete') return navigate(dest, { replace: true });
      setResumeEmail(resume.email);
      setVerifying(true);
    } catch (err) {
      haptics.error();
      setGeneral(friendlyClerkError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const title = door === 'daycare' ? 'Let’s set up your daycare' : door === 'parent' ? 'Let’s get you started' : 'Create your account';
  const sub =
    door === 'daycare'
      ? 'First, a little about you. Your daycare comes next.'
      : door === 'parent'
        ? 'First, a little about you. Your little one comes next.'
        : 'So your invite is saved to you.';

  return (
    <Step
      back={() => navigate(-1)}
      steps={steps}
      hero={
        door ? <Illustration asset={door === 'daycare' ? 'onboarding.daycareDoor' : 'onboarding.parentDoor'} size={96} priority /> : undefined
      }
      title={title}
      sub={sub}
      footer={
        <div className="flex flex-col gap-1">
          <Button type="submit" form="signup-form" size="lg" fullWidth haptic loading={busy} disabled={!ready}>
            Create my account
          </Button>
          <Button variant="ghost" size="sm" fullWidth onClick={() => navigate(p('/signin') + carry(), { replace: true })}>
            Already have an account? Sign in
          </Button>
        </div>
      }
    >
      {resume && ops.resumeSignUp ? (
        <Card tone="sky" className="mb-4 flex flex-col gap-2 p-4">
          <p className="text-[15px] font-semibold text-ink">Welcome back! You were signing up as {resume.email}.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={busy} onClick={() => void continueSignUp()}>
              Pick up where I left off
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setResume(null)}>
              Start over
            </Button>
          </div>
        </Card>
      ) : null}
      <form id="signup-form" onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="First name"
            autoComplete="given-name"
            autoCapitalize="words"
            enterKeyHint="next"
            value={first}
            onChange={(e) => setFirst(e.target.value)}
            onFocus={(e) => scrollIntoViewSoon(e.currentTarget)}
          />
          <Field
            label="Last name"
            autoComplete="family-name"
            autoCapitalize="words"
            enterKeyHint="next"
            value={last}
            onChange={(e) => setLast(e.target.value)}
            onFocus={(e) => scrollIntoViewSoon(e.currentTarget)}
          />
        </div>
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
            clearErr('email');
          }}
          onFocus={(e) => scrollIntoViewSoon(e.currentTarget)}
        />
        <PasswordField
          value={password}
          error={fieldErr.password}
          onChange={(v) => {
            setPassword(v);
            clearErr('password');
          }}
        />
        {/* Clerk's bot protection mounts its widget here in custom flows; without it Clerk falls back to an invisible check. */}
        <div id="clerk-captcha" />
        {general ? <InlineError message={general} /> : null}
        {/* Enter submits from any field; the visible button lives in the sticky footer. */}
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </form>
    </Step>
  );
}
