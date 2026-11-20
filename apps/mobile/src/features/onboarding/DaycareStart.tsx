import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Field, Illustration } from '../../ui';
import { api, ApiError, friendlyMessage } from '../../lib/api';
import { haptics } from '../../lib/native';
import { qk } from '../../lib/queries';
import { setDevice, setRolePref } from '../../lib/storage';
import { defaultTimezone, scrollIntoViewSoon } from './lib';
import { EmblemPicker, emblemKey, emblemLabel as label, type Emblem } from './EmblemPicker';
import { InlineError, Step } from './Step';
import { TimezonePicker } from './TimezonePicker';

type Stage = 'profile' | 'classroom' | 'tablet';

/** Daycare door, after sign-up: profile, first classroom (emblem picker), shared-tablet question, then /admin. */
export function DaycareStart() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [stage, setStage] = useState<Stage>('profile');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [timezone, setTimezone] = useState(defaultTimezone);
  const [emblem, setEmblem] = useState<Emblem>('butterflies');
  const [room, setRoom] = useState(label('butterflies'));
  const [roomTouched, setRoomTouched] = useState(false);
  const [busy, setBusy] = useState<null | 'next' | 'yes' | 'no'>(null);
  const [problem, setProblem] = useState<{ message: string; retry: () => void } | null>(null);
  const org = useRef<string | null>(null);
  const roomMade = useRef(false);

  const fail = (err: unknown, retry: () => void) => {
    haptics.error();
    setProblem({ message: err instanceof ApiError ? friendlyMessage(err.code) : friendlyMessage('INTERNAL'), retry });
  };

  const saveProfile = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!name.trim() || busy) return;
    setBusy('next');
    setProblem(null);
    try {
      const body = { name: name.trim(), address: address.trim(), timezone };
      if (org.current) await api(`/orgs/${encodeURIComponent(org.current)}`, { method: 'PATCH', json: body });
      else org.current = (await api<{ id: string }>('/orgs', { method: 'POST', json: body })).id;
      haptics.success();
      setStage('classroom');
    } catch (err) {
      fail(err, () => void saveProfile());
    } finally {
      setBusy(null);
    }
  };

  const saveRoom = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!room.trim() || !org.current || busy) return;
    setBusy('next');
    setProblem(null);
    try {
      if (!roomMade.current) {
        await api(`/orgs/${encodeURIComponent(org.current)}/classrooms`, { method: 'POST', json: { name: room.trim(), assetKey: emblemKey(emblem) } });
        roomMade.current = true;
      }
      haptics.success();
      setStage('tablet');
    } catch (err) {
      fail(err, () => void saveRoom());
    } finally {
      setBusy(null);
    }
  };

  const finish = async (sharedTablet: boolean) => {
    if (!org.current || busy) return;
    setBusy(sharedTablet ? 'yes' : 'no');
    setProblem(null);
    try {
      if (sharedTablet) {
        const { deviceId } = await api<{ deviceId: string }>(`/orgs/${encodeURIComponent(org.current)}/devices`, { method: 'POST' });
        await setDevice({ orgId: org.current, deviceId });
      }
      await setRolePref('admin');
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[1] !== 'me' });
      await qc.refetchQueries({ queryKey: qk.me() });
      haptics.success();
      navigate('/admin', { replace: true });
    } catch (err) {
      fail(err, () => void finish(sharedTablet));
    } finally {
      setBusy(null);
    }
  };

  if (stage === 'tablet') {
    return (
      <Step
        key="tablet"
        center
        hero={<Illustration asset="empty.rosterEmpty" size={110} priority />}
        title="Will this device be a shared classroom tablet?"
        sub="Teachers tap their name and enter a PIN to use it. You can change this later."
      >
        <Button size="lg" fullWidth variant="sun" haptic loading={busy === 'yes'} disabled={busy === 'no'} onClick={() => void finish(true)}>
          Yes, it lives in the classroom 🏫
        </Button>
        <Button size="lg" fullWidth variant="white" haptic loading={busy === 'no'} disabled={busy === 'yes'} onClick={() => void finish(false)}>
          No, this is my own phone 📱
        </Button>
        {problem ? <InlineError message={problem.message} onRetry={problem.retry} retrying={busy !== null} /> : null}
      </Step>
    );
  }

  if (stage === 'classroom') {
    return (
      <Step
        key="classroom"
        steps={{ total: 3, current: 3 }}
        back={() => {
          setProblem(null);
          setStage('profile');
        }}
        title="Create your first classroom"
        sub="Pick a badge and give the room a name. You can add more rooms later."
        footer={
          <Button type="submit" form="room-form" size="lg" fullWidth haptic loading={busy === 'next'} disabled={!room.trim()}>
            Continue
          </Button>
        }
      >
        <form id="room-form" onSubmit={(e) => void saveRoom(e)} noValidate className="flex flex-col gap-4">
          <EmblemPicker
            value={emblem}
            onChange={(em) => {
              setEmblem(em);
              if (!roomTouched) setRoom(label(em));
            }}
          />
          <Field
            label="Classroom name"
            value={room}
            enterKeyHint="done"
            onChange={(e) => {
              setRoom(e.target.value);
              setRoomTouched(true);
            }}
            onFocus={(e) => scrollIntoViewSoon(e.currentTarget)}
          />
          {problem ? <InlineError message={problem.message} onRetry={problem.retry} retrying={busy !== null} /> : null}
          <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
        </form>
      </Step>
    );
  }

  return (
    <Step
      key="profile"
      steps={{ total: 3, current: 2 }}
      hero={<Illustration asset="onboarding.daycareDoor" size={96} priority />}
      title="Tell us about your daycare"
      sub="Parents see this when they connect with you."
      footer={
        <Button type="submit" form="daycare-form" size="lg" fullWidth haptic loading={busy === 'next'} disabled={!name.trim()}>
          Continue
        </Button>
      }
    >
      <form id="daycare-form" onSubmit={(e) => void saveProfile(e)} noValidate className="flex flex-col gap-4">
        <Field label="Daycare name" autoCapitalize="words" enterKeyHint="next" value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => scrollIntoViewSoon(e.currentTarget)} />
        <Field
          label="Address"
          autoComplete="street-address"
          autoCapitalize="words"
          enterKeyHint="next"
          hint="So parents know they have the right place."
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onFocus={(e) => scrollIntoViewSoon(e.currentTarget)}
        />
        <TimezonePicker value={timezone} onChange={setTimezone} />
        {problem ? <InlineError message={problem.message} onRetry={problem.retry} retrying={busy !== null} /> : null}
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </form>
    </Step>
  );
}
