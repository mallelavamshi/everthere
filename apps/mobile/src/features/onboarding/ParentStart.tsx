import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar, Button, Field } from '../../ui';
import { api, ApiError, friendlyMessage } from '../../lib/api';
import { haptics } from '../../lib/native';
import { qk } from '../../lib/queries';
import { setRolePref } from '../../lib/storage';
import { ageLabel, defaultTimezone, scrollIntoViewSoon } from './lib';
import { BirthdayField } from './BirthdayField';
import { InlineError, Step } from './Step';

/** Parent door, after sign-up: family + "Add your first child", then straight into avatar setup. */
export function ParentStart() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [birthday, setBirthday] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // A retry after a half-finished attempt must not create the family or the child twice.
  const done = useRef<{ family: boolean; child: boolean }>({ family: false, child: false });

  const age = ageLabel(birthday);
  const futureOrBad = birthday !== '' && age === null;
  const ready = name.trim() !== '' && age !== null;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      if (!done.current.family) {
        await api('/families', { method: 'POST' });
        done.current.family = true;
      }
      if (!done.current.child) {
        await api('/children', { method: 'POST', json: { name: name.trim(), birthday, timezone: defaultTimezone() } });
        done.current.child = true;
      }
      await setRolePref('parent');
      // The parent routes check the roles in /api/me: refresh it BEFORE navigating or they would bounce us back.
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[1] !== 'me' });
      await qc.refetchQueries({ queryKey: qk.me() });
      haptics.success();
      navigate('/parent/avatar/setup', { replace: true });
    } catch (err) {
      haptics.error();
      setProblem(err instanceof ApiError ? friendlyMessage(err.code) : friendlyMessage('INTERNAL'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Step
      steps={{ total: 3, current: 2 }}
      center
      hero={<Avatar name={name.trim() || undefined} emoji={name.trim() ? undefined : '🧸'} size={96} ring />}
      title="Add your first child"
      sub="Tell us about your little one."
      footer={
        <Button type="submit" form="child-form" size="lg" fullWidth haptic loading={busy} disabled={!ready}>
          Continue
        </Button>
      }
    >
      <form id="child-form" onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4 text-left">
        <Field
          label="Their first name"
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="next"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => scrollIntoViewSoon(e.currentTarget)}
        />
        <BirthdayField value={birthday} onChange={setBirthday} error={futureOrBad ? "Birthdays can't be in the future 🙈" : undefined} />
        <div aria-live="polite" className="min-h-[44px]">
          {age ? (
            <p className="inline-flex min-h-[44px] items-center rounded-full border-2 border-ink bg-mint px-5 text-[18px] font-semibold">{age}</p>
          ) : null}
        </div>
        <p className="rounded-card bg-lilac px-4 py-3 text-center text-[14px] leading-snug">
          Next up: a photo and your voice, so {name.trim() || 'your little one'} can see and hear you 🌈
        </p>
        {problem ? <InlineError message={problem} onRetry={() => void submit()} retrying={busy} /> : null}
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </form>
    </Step>
  );
}
