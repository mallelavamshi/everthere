import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { ChildView } from '@everthere/shared';
import { ApiError, api, friendlyMessage } from '../../lib/api';
import { downscaleForUpload } from '../../lib/image';
import { haptics } from '../../lib/native';
import { qk } from '../../lib/queries';
import { Avatar, Button, Field, Screen } from '../../ui';
import { uploadMedia } from '../avatar/avatarApi';
import { ageLabel, defaultTimezone, scrollIntoViewSoon } from '../onboarding/lib';
import { BirthdayField } from '../onboarding/BirthdayField';
import { InlineError } from '../onboarding/Step';
import { TimezonePicker } from '../onboarding/TimezonePicker';

/** Add a child, or edit one (pass `child`): photo, first name, birthday and time zone. */
export function ChildForm({ child }: { child?: ChildView }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(child?.name ?? '');
  const [birthday, setBirthday] = useState(child?.birthday ?? '');
  const [timezone, setTimezone] = useState(child?.timezone ?? defaultTimezone());
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const uploaded = useRef<{ file: File; key: string } | null>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const age = ageLabel(birthday);
  const futureOrBad = birthday !== '' && age === null;
  const ready = name.trim() !== '' && age !== null;
  const done = () => navigate('/parent', { replace: true });

  const save = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      let photoKey: string | undefined;
      if (file) {
        if (uploaded.current?.file === file) photoKey = uploaded.current.key;
        else {
          const small = await downscaleForUpload(file, 1600);
          photoKey = (await uploadMedia(small, 'child', 'child.jpg')).key;
          uploaded.current = { file, key: photoKey };
        }
      }
      if (child) {
        // Only what changed: a demo account may not touch the name or photo, and must still be able to save the rest.
        const patch: Record<string, unknown> = {};
        if (name.trim() !== child.name) patch.name = name.trim();
        if (birthday !== (child.birthday ?? '')) patch.birthday = birthday;
        if (timezone !== child.timezone) patch.timezone = timezone;
        if (photoKey) patch.photoKey = photoKey;
        if (Object.keys(patch).length) await api(`/children/${encodeURIComponent(child.id)}`, { method: 'PATCH', json: patch });
      } else {
        await api('/children', { method: 'POST', json: { name: name.trim(), birthday, timezone, ...(photoKey ? { photoKey } : {}) } });
      }
      haptics.success();
      await qc.invalidateQueries({ queryKey: qk.children() });
      done();
    } catch (e) {
      haptics.error();
      setProblem(friendlyMessage(e instanceof ApiError ? e.code : 'INTERNAL'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      back={done}
      title={child ? `Edit ${child.name}` : 'Add your child'}
      footer={
        <Button size="lg" fullWidth haptic loading={busy} disabled={!ready} onClick={() => void save()}>
          {child ? 'Save' : 'Add child'}
        </Button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        noValidate
        className="flex flex-col gap-5 pt-2"
      >
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            aria-label={preview || child?.photoUrl ? 'Change photo' : 'Add a photo'}
            onClick={() => fileRef.current?.click()}
            className="relative grid h-28 w-28 place-items-center rounded-full active:scale-95"
          >
            <Avatar src={preview ?? child?.photoUrl} emoji="🧸" name={name.trim() || undefined} size={112} ring />
            <span aria-hidden="true" className="absolute bottom-0 right-0 grid h-9 w-9 place-items-center rounded-full border-2 border-ink bg-sun text-[16px]">
              📷
            </span>
          </button>
          <span className="text-[14px] text-mutedText">{preview ? 'Looking good!' : child?.photoUrl ? 'Tap to change the photo' : 'Add a photo (optional)'}</span>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <Field
          label="Their first name"
          autoComplete="off"
          autoCapitalize="words"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => scrollIntoViewSoon(e.currentTarget)}
        />
        <BirthdayField value={birthday} onChange={setBirthday} error={futureOrBad ? "Birthdays can't be in the future 🙈" : undefined} />
        {age ? <p className="inline-flex min-h-[44px] items-center self-start rounded-full border-2 border-ink bg-mint px-5 text-[16px] font-semibold">{age}</p> : null}
        <TimezonePicker value={timezone} onChange={setTimezone} label="Where they live" />
        {problem ? <InlineError message={problem} onRetry={() => void save()} retrying={busy} /> : null}
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </form>
    </Screen>
  );
}
