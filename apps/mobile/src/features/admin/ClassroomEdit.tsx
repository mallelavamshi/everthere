import { useRef, useState } from 'react';
import clsx from 'clsx';
import { useQueryClient } from '@tanstack/react-query';
import type { ClassroomView, StaffMember } from '@everthere/shared';
import { api, ApiError, friendlyMessage } from '../../lib/api';
import { haptics } from '../../lib/native';
import { qk } from '../../lib/queries';
import { Avatar, Button, Chip, Field, Sheet, toast } from '../../ui';
import { EMBLEMS, EmblemPicker, emblemKey, emblemLabel, emblemOf, type Emblem } from '../onboarding/EmblemPicker';

/** What the classroom wears: one of the curated badges, or the emoji it was created with. */
type Badge = { kind: 'asset'; emblem: Emblem } | { kind: 'emoji'; emoji: string };

export interface ClassroomEditProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  /** Omit to create. */
  classroom?: ClassroomView | null;
  staff: StaffMember[];
  /** Badges already in use by other classrooms, so a new one starts on a fresh badge. */
  takenAssetKeys?: string[];
  /** The children enrolled in this classroom (read-only: children are assigned when they are enrolled). */
  childNames?: string[];
}

const initialBadge = (c: ClassroomView | null | undefined, taken: string[]): Badge => {
  if (c) {
    const em = emblemOf(c.assetKey);
    if (em) return { kind: 'asset', emblem: em };
    if (c.emoji) return { kind: 'emoji', emoji: c.emoji };
  }
  return { kind: 'asset', emblem: EMBLEMS.find((e) => !taken.includes(emblemKey(e))) ?? 'butterflies' };
};

/**
 * Create or edit a classroom: name, badge and teachers. Mount it with a fresh `key` per opening so it starts from the
 * classroom it was given. Children are shown, not edited: they join a classroom through Enrollments.
 */
export function ClassroomEdit({ open, onClose, orgId, classroom, staff, takenAssetKeys = [], childNames = [] }: ClassroomEditProps) {
  const qc = useQueryClient();
  const editing = !!classroom;
  const [start] = useState(() => initialBadge(classroom, takenAssetKeys));
  const [badge, setBadge] = useState<Badge>(start);
  const [name, setName] = useState(() => classroom?.name ?? (start.kind === 'asset' ? emblemLabel(start.emblem) : ''));
  const [touched, setTouched] = useState(editing);
  const [picked, setPicked] = useState<string[]>(() => classroom?.staffUserIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const patched = useRef(false); // the rename/badge write landed already; a retry after a failed teacher step skips it
  const madeId = useRef<string | null>(null); // a create that succeeded but whose teacher step failed is not repeated on retry

  const trimmed = name.trim();
  const order = [...staff].sort((a, b) => Number(a.role === 'admin') - Number(b.role === 'admin'));
  const sameStaff = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

  const save = async () => {
    if (!trimmed || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const body = badge.kind === 'asset' ? { name: trimmed, assetKey: emblemKey(badge.emblem) } : { name: trimmed, emoji: badge.emoji };
    // Staff in the order the list shows them, so the request is stable.
    const userIds = staff.filter((s) => picked.includes(s.userId)).map((s) => s.userId);
    // An emoji badge is only ever the one the room already has, so only a picked emblem can be a change.
    const badgeChanged = badge.kind === 'asset' && emblemKey(badge.emblem) !== classroom?.assetKey;
    try {
      let id = classroom?.id ?? madeId.current;
      if (!id) {
        id = (await api<ClassroomView>(`/orgs/${encodeURIComponent(orgId)}/classrooms`, { method: 'POST', json: body })).id;
        madeId.current = id;
      } else if (editing && !patched.current && (trimmed !== classroom!.name || badgeChanged)) {
        await api(`/classrooms/${encodeURIComponent(id)}`, { method: 'PATCH', json: body });
        patched.current = true;
      }
      if (userIds.length > 0 || (editing && !sameStaff(userIds, classroom!.staffUserIds))) {
        await api(`/classrooms/${encodeURIComponent(id)}/staff`, { method: 'PUT', json: { userIds } });
      }
      haptics.success();
      toast.success(editing ? 'Classroom saved 💛' : `${trimmed} is ready 🎉`);
      void qc.invalidateQueries({ queryKey: qk.orgClassrooms(orgId) });
      void qc.invalidateQueries({ queryKey: qk.orgStaff(orgId) });
      onClose();
    } catch (e) {
      haptics.error();
      setError(friendlyMessage(e instanceof ApiError ? e.code : 'INTERNAL'));
      if (madeId.current || patched.current) void qc.invalidateQueries({ queryKey: qk.orgClassrooms(orgId) });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? 'Edit classroom' : 'New classroom'}
      footer={
        <Button fullWidth loading={busy} disabled={!trimmed} onClick={() => void save()}>
          {error ? 'Try again' : editing ? 'Save changes' : 'Create classroom'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 py-2">
        <EmblemPicker
          value={badge.kind === 'asset' ? badge.emblem : undefined}
          onChange={(em) => {
            setBadge({ kind: 'asset', emblem: em });
            if (!touched) setName(emblemLabel(em));
          }}
          extra={
            badge.kind === 'emoji' ? (
              <button
                type="button"
                role="radio"
                aria-checked
                aria-label={`Emoji ${badge.emoji}`}
                className={clsx('flex min-h-[88px] flex-col items-center justify-center gap-1 rounded-card border-2 border-ink bg-sun p-1.5 shadow-chunky')}
              >
                <span aria-hidden="true" className="text-[32px] leading-none">
                  {badge.emoji}
                </span>
                <span aria-hidden="true" className="text-[12px] font-semibold">
                  Current
                </span>
              </button>
            ) : null
          }
        />
        <Field
          label="Classroom name"
          value={name}
          maxLength={40}
          enterKeyHint="done"
          onChange={(e) => {
            setName(e.target.value);
            setTouched(true);
          }}
        />

        <div className="flex flex-col gap-2">
          <p className="text-[14px] font-semibold">Teachers</p>
          {staff.length === 0 ? (
            <p className="text-[14px] text-mutedText">Invite a teacher from the Staff tab, then pick them here.</p>
          ) : (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Teachers in this classroom">
              {order.map((s) => (
                <Chip
                  key={s.userId}
                  selected={picked.includes(s.userId)}
                  icon={<Avatar name={s.name || s.email} size={24} />}
                  onClick={() => setPicked((p) => (p.includes(s.userId) ? p.filter((x) => x !== s.userId) : [...p, s.userId]))}
                >
                  {s.name || s.email || 'Unnamed'}
                </Chip>
              ))}
            </div>
          )}
        </div>

        {editing ? (
          <div className="flex flex-col gap-2">
            <p className="text-[14px] font-semibold">Children</p>
            {childNames.length === 0 ? (
              <p className="text-[14px] text-mutedText">No children yet. Add them from the Enrollments tab.</p>
            ) : (
              <ul className="flex flex-wrap gap-2" aria-label="Children in this classroom">
                {childNames.map((n, i) => (
                  <li key={`${n}-${i}`} className="rounded-full border-2 border-line bg-white px-3 py-1 text-[14px]">
                    {n}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[12px] text-mutedText">Children join a classroom when you enrol them.</p>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-card bg-flag p-3 text-[14px]">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
