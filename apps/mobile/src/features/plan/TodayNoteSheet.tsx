import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ChildView } from '@everthere/shared';
import { ApiError, friendlyMessage } from '../../lib/api';
import { haptics } from '../../lib/native';
import { qk } from '../../lib/queries';
import { Button, Chip, Field, Sheet, toast } from '../../ui';
import { fetchPlan, LIMITS, putPlan, toInput } from './planApi';

export const NOTE_SUGGESTIONS = ['Grandma picks up today', 'Daddy picks up today', 'Pajama day!'] as const;

/** The avatars of this child that the signed-in parent owns and that are finished (ready or approved). */
export function ownedReadyAvatarIds(child: ChildView, fallback: string[] = []): string[] {
  if (!child.familyAvatars) return fallback;
  return child.familyAvatars.filter((a) => a.isMine && (a.status === 'approved' || a.status === 'ready')).map((a) => a.avatarId);
}

export interface TodayNoteSheetProps {
  open: boolean;
  onClose: () => void;
  child: ChildView;
  /** The current note, if any. */
  note?: string | null;
  /** The caller's own finished avatars, used only when the child has no family avatar list yet. */
  fallbackAvatarIds?: string[];
}

/**
 * "Add a note for today": one line that every one of your avatars for this child knows about until local midnight.
 * Saving writes the note through the plan PUT for each avatar you own, keeping the rest of each plan as it is.
 */
export function TodayNoteSheet({ open, onClose, child, note, fallbackAvatarIds }: TodayNoteSheetProps) {
  const qc = useQueryClient();
  const [text, setText] = useState(note ?? '');
  /** Avatars whose write failed on the last save; Save becomes "Try again" for just these. */
  const [failed, setFailed] = useState<string[]>([]);
  const ids = ownedReadyAvatarIds(child, fallbackAvatarIds);

  // Start from the current note each time the sheet opens.
  useEffect(() => {
    if (open) {
      setText(note ?? '');
      setFailed([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const write = useMutation({
    mutationFn: async (todayNote: string) => {
      const targets = failed.length ? ids.filter((id) => failed.includes(id)) : ids;
      const results = await Promise.allSettled(
        targets.map(async (avatarId) => {
          // The PUT replaces the whole plan, so start from the freshest copy.
          const plan = await qc.fetchQuery({
            queryKey: qk.plan(child.id, avatarId),
            queryFn: ({ signal }) => fetchPlan(child.id, avatarId, signal),
            staleTime: 0,
          });
          qc.setQueryData(qk.plan(child.id, avatarId), await putPlan(child.id, avatarId, toInput(plan, { todayNote })));
        }),
      );
      const bad = targets.filter((_, i) => results[i]!.status === 'rejected');
      const reason = (results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined)?.reason;
      return { todayNote, bad, anySaved: bad.length < targets.length || failed.length > bad.length, reason };
    },
    onSuccess: ({ todayNote, bad, anySaved, reason }) => {
      setFailed(bad);
      if (bad.length === 0) {
        haptics.success();
        toast.success(todayNote ? 'Note saved. It clears at midnight 💛' : 'Note cleared');
        onClose();
        return;
      }
      haptics.error();
      if (!anySaved) toast.error(reason instanceof ApiError ? friendlyMessage(reason.code) : friendlyMessage('INTERNAL'));
    },
  });

  const titleOf = (id: string) => child.familyAvatars?.find((a) => a.avatarId === id)?.parentTitle;
  const failedNames = failed.map((id) => titleOf(id)).filter(Boolean).map((t) => `${t}'s`);
  const partial = failed.length > 0 && failed.length < ids.length;
  const failCopy = partial
    ? `Saved for your other avatar, but we couldn't reach ${failedNames.join(' and ') || 'one'} — try again`
    : "We couldn't save the note. Please try again";

  const trimmed = text.trim();
  const had = (note ?? '').trim();
  const clearing = trimmed === '' && had !== '';
  const retrying = failed.length > 0;
  const canSave = ids.length > 0 && (retrying || trimmed !== had) && !write.isPending;
  const near = text.length >= LIMITS.note - 20;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add a note for today"
      footer={
        <Button size="lg" fullWidth loading={write.isPending} disabled={!canSave} onClick={() => write.mutate(trimmed)}>
          {retrying ? 'Try again' : clearing ? 'Clear note' : 'Save note'}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 pb-2">
        <p className="text-[15px] leading-snug">
          A little heads-up for {child.name}'s avatar, like who is picking up or a special treat, so the comfort feels extra personal.
        </p>
        <Field
          label="Today's note"
          data-autofocus
          value={text}
          maxLength={LIMITS.note}
          placeholder="Like who is picking up"
          enterKeyHint="done"
          autoCapitalize="sentences"
          onChange={(e) => {
            setText(e.target.value.slice(0, LIMITS.note));
            setFailed([]); // a new text goes to every avatar again
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSave) write.mutate(trimmed);
          }}
        />
        <div className="flex items-center justify-between text-[13px] text-mutedText">
          <p>Clears at midnight.</p>
          {near ? (
            <span aria-live="polite">
              {text.length} / {LIMITS.note}
            </span>
          ) : null}
        </div>
        <div role="group" aria-label="Quick notes" className="flex flex-wrap gap-2">
          {NOTE_SUGGESTIONS.map((s) => (
            <Chip
              key={s}
              tone="add"
              onClick={() => {
                setText(s);
                setFailed([]);
              }}
            >
              {s}
            </Chip>
          ))}
        </div>
        {retrying ? (
          <p role="alert" className="rounded-card bg-flag px-4 py-3 text-[14px] leading-snug">
            {failCopy}
          </p>
        ) : null}
        {ids.length === 0 ? (
          <p className="rounded-card bg-lilac px-4 py-3 text-[14px] leading-snug">Once your avatar is ready, notes like this will be passed along to it 💜</p>
        ) : null}
      </div>
    </Sheet>
  );
}
