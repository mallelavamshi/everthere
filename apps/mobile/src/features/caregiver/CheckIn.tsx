import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { MoodAfter } from '@everthere/shared';
import { api, ApiError, friendlyMessage } from '../../lib/api';
import { Button, Field, Illustration, Screen } from '../../ui';
import { Confetti } from '../avatar/Confetti';

const MOODS: { value: MoodAfter; emoji: string; label: string }[] = [
  { value: 'calmer', emoji: '😊', label: 'Calmer' },
  { value: 'same', emoji: '😐', label: 'Same' },
  { value: 'upset', emoji: '😢', label: 'Still upset' },
];
export const NOTE_MAX = 280;
const AUTO_BACK_MS = 5_000;

export interface CheckInProps {
  sessionId: string;
  childName: string;
  parentTitle: string;
  /** The parent's first name for "Send to Sarah"; the title ("Mommy") stands in when unknown. */
  parentName?: string;
  /** How long the call was, in seconds (the server's duration, else the live time), when known. */
  durationS?: number;
  /** Check-in sent (after the celebration) or skipped. Called once. */
  onDone: () => void;
}

/**
 * Mockup 8: after a call, one tap for how the child is now, an optional note, and it goes to the parent with the
 * summary. A failed send keeps everything the teacher entered and offers Retry.
 */
/** "2 min" (rounded to the nearest minute), "Under a minute" below 60 s, null when unknown (device test P-7). */
export function callLengthLabel(durationS: number | undefined): string | null {
  if (durationS === undefined || !Number.isFinite(durationS) || durationS < 0) return null;
  if (durationS < 60) return 'Under a minute';
  return `${Math.round(durationS / 60)} min`;
}

export function CheckIn({ sessionId, childName, parentTitle, parentName, durationS, onDone }: CheckInProps) {
  const length = callLengthLabel(durationS);
  const [mood, setMood] = useState<MoodAfter | null>(null);
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<'edit' | 'sending' | 'error' | 'sent'>('edit');
  const [message, setMessage] = useState('');
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };
  const who = parentName || parentTitle;

  useEffect(() => {
    if (phase !== 'sent') return;
    const t = setTimeout(finish, AUTO_BACK_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const send = async () => {
    if (!mood || phase === 'sending') return;
    setPhase('sending');
    try {
      const text = note.trim();
      await api(`/sessions/${encodeURIComponent(sessionId)}/checkin`, { method: 'POST', json: { moodAfter: mood, ...(text ? { note: text } : {}) } });
      setPhase('sent');
    } catch (e) {
      setMessage(friendlyMessage(e instanceof ApiError ? e.code : 'INTERNAL'));
      setPhase('error');
    }
  };

  if (phase === 'sent') {
    return (
      <Screen>
        <div className="relative mx-auto flex min-h-full w-full max-w-[460px] flex-col items-center justify-center gap-3 text-center">
          <Confetti />
          <Illustration asset="moment.checkIn" size={200} priority />
          <h1 className="text-[26px] font-semibold leading-tight text-ink">Sent to {who} 💛</h1>
          <p className="text-[16px] text-mutedText">
            {who} will see how {childName} is doing.
          </p>
          <Button size="lg" fullWidth haptic onClick={finish} className="mt-3">
            Back to the classroom
          </Button>
        </div>
      </Screen>
    );
  }

  const sending = phase === 'sending';
  return (
    <Screen>
      <div className="mx-auto flex min-h-full w-full max-w-[460px] flex-col justify-center gap-4 py-4 text-center">
        <Illustration asset="moment.checkIn" size={112} priority className="mx-auto" />
        <div>
          <h1 className="text-[26px] font-semibold leading-tight text-ink">Nice! How&apos;s {childName} now?</h1>
          <p className="mt-1 text-[14px] text-mutedText">
            {length ? `${length} with ${parentTitle}'s avatar` : `A quick visit with ${parentTitle}'s avatar`}
          </p>
        </div>
        <div role="radiogroup" aria-label={`How ${childName} is now`} className="flex gap-3">
          {MOODS.map((m) => {
            const on = mood === m.value;
            return (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={sending}
                onClick={() => setMood(m.value)}
                className={clsx(
                  'flex min-h-[84px] flex-1 flex-col items-center justify-center gap-1 rounded-btn border-btn border-ink text-[15px] font-semibold shadow-chunky transition-colors active:translate-y-[3px] active:shadow-none disabled:opacity-60',
                  on ? 'bg-sun' : 'bg-white',
                )}
              >
                <span aria-hidden="true" className="text-[28px] leading-none">
                  {m.emoji}
                </span>
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>
        <Field
          multiline
          label={`Add a note for ${who} (optional)`}
          placeholder="Went right down for nap!"
          maxLength={NOTE_MAX}
          value={note}
          disabled={sending}
          hint={`${note.length}/${NOTE_MAX}`}
          onChange={(e) => setNote(e.target.value)}
          className="text-left"
        />
        {phase === 'error' ? (
          <p role="alert" className="text-[14px] font-semibold text-danger">
            {message} Your check-in is kept here, so just tap Retry.
          </p>
        ) : null}
        <Button size="lg" variant="coral" fullWidth haptic loading={sending} disabled={!mood} onClick={() => void send()}>
          {phase === 'error' ? 'Retry' : `Send to ${who} 💌`}
        </Button>
        <Button variant="ghost" size="sm" fullWidth disabled={sending} onClick={finish}>
          Skip for now
        </Button>
      </div>
    </Screen>
  );
}
