import { useRef, useState } from 'react';
import clsx from 'clsx';
import { useQueryClient } from '@tanstack/react-query';
import type { ClassroomView, EnrollmentView } from '@everthere/shared';
import { api, ApiError, friendlyMessage } from '../../lib/api';
import { haptics } from '../../lib/native';
import { qk } from '../../lib/queries';
import { Button, Field, Sheet } from '../../ui';
import { CodeDisplay, ShareButtons } from '../caregivers/CodeDisplay';
import { shareText } from '../caregivers/shareCode';
import { Emblem } from './Emblem';

export interface EnrollSheetProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  orgName: string;
  classrooms: ClassroomView[];
  /** Start with these filled in (a stale invite being recreated). */
  prefill?: { childName: string; classroomId: string };
  /** Skip creating and just show this code (re-sharing a live invite). */
  existing?: { code: string; childName: string; expiresAt?: number };
}

/**
 * Enrol a child: a name and a classroom, then the family's invite code with Share and Copy.
 * Mount it with a fresh `key` per opening, so it starts clean (or from `prefill` / `existing`).
 */
export function EnrollSheet({ open, onClose, orgId, orgName, classrooms, prefill, existing }: EnrollSheetProps) {
  const qc = useQueryClient();
  const [childName, setChildName] = useState(prefill?.childName ?? '');
  const [classroomId, setClassroomId] = useState(prefill?.classroomId ?? '');
  const [code, setCode] = useState<string | null>(existing?.code ?? null);
  const [shownName, setShownName] = useState(existing?.childName ?? '');
  const [expiresAt, setExpiresAt] = useState<number | undefined>(existing?.expiresAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const name = childName.trim();
  const canCreate = name.length > 0 && !!classroomId && classrooms.some((c) => c.id === classroomId);

  const create = async () => {
    if (!canCreate || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ enrollment: EnrollmentView; code: string; expiresAt: number }>(`/orgs/${encodeURIComponent(orgId)}/enrollments`, {
        method: 'POST',
        json: { childName: name, classroomId },
      });
      setShownName(name);
      setCode(res.code);
      setExpiresAt(res.expiresAt);
      haptics.success();
      void qc.invalidateQueries({ queryKey: qk.enrollments(orgId) });
      void qc.invalidateQueries({ queryKey: qk.rosterAll() });
    } catch (e) {
      haptics.error();
      setError(friendlyMessage(e instanceof ApiError ? e.code : 'INTERNAL'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={existing ? `Share invite for ${existing.childName}` : 'Invite a family'}
      footer={
        code ? (
          <ShareButtons text={shareText('enrollment', [orgName], code)} />
        ) : (
          <Button fullWidth loading={busy} disabled={!canCreate} onClick={() => void create()}>
            {error ? 'Try again' : 'Create invite'}
          </Button>
        )
      }
    >
      {code ? (
        <CodeDisplay code={code} expiresAt={expiresAt} lead={shownName ? `Send this code to the family of ${shownName}` : "Send this code to the family"} />
      ) : (
        <form
          className="flex flex-col gap-4 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <Field label="Child’s name" value={childName} maxLength={60} autoCapitalize="words" enterKeyHint="done" onChange={(e) => setChildName(e.target.value)} />
          <div className="flex flex-col gap-2">
            <p className="text-[14px] font-semibold">Classroom</p>
            {classrooms.length === 0 ? (
              <p className="text-[14px] text-mutedText">Add a classroom first, then you can invite families.</p>
            ) : (
              <div role="radiogroup" aria-label="Classroom" className="grid grid-cols-2 gap-2">
                {classrooms.map((c) => {
                  const on = c.id === classroomId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={c.name}
                      onClick={() => {
                        setClassroomId(c.id);
                        haptics.light();
                      }}
                      className={clsx(
                        'flex min-h-[56px] items-center gap-2 rounded-seg border-2 px-3 text-left',
                        on ? 'border-ink bg-sun shadow-chunky' : 'border-line bg-white',
                      )}
                    >
                      <Emblem assetKey={c.assetKey} emoji={c.emoji} size={32} />
                      <span aria-hidden="true" className="min-w-0 truncate text-[15px] font-medium">
                        {c.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {error ? (
            <p role="alert" className="rounded-card bg-flag p-3 text-[14px]">
              {error}
            </p>
          ) : null}
          <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
        </form>
      )}
    </Sheet>
  );
}
