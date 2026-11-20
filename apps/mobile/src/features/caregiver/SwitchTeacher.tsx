import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { StaffSwitchEntry } from '@everthere/shared';
import { api, ApiError, friendlyMessage } from '../../lib/api';
import { useStaffSwitch } from '../../lib/queries';
import { setActingToken, type ActingToken } from '../../lib/storage';
import { Avatar, Button, Sheet, Skeleton, toast, useShortScreen } from '../../ui';
import { PinPad } from '../onboarding/PinPad';

export const LOCKED_COPY = 'Too many tries — take a breather and try again in a few minutes';
export const WRONG_PIN_COPY = "That PIN didn't match. Try again 💛";

export interface SwitchTeacherProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  deviceId: string;
  /** Who is teaching now (shows End shift). */
  acting: ActingToken | null;
  /** The new teacher's token is stored; the roster should refetch as them. */
  onSwitched: () => void;
  onEndShift: () => void;
  /** The API said this device is unknown: the stored registration is stale. */
  onDeviceGone: () => void;
}

/**
 * "Who's teaching?" on a shared classroom tablet: staff faces, then their own 4-digit PIN. A correct PIN returns a 12 h
 * acting token that the API client sends from then on, so check-ins are attributed to that teacher.
 */
export function SwitchTeacher({ open, onClose, orgId, deviceId, acting, onSwitched, onEndShift, onDeviceGone }: SwitchTeacherProps) {
  const staff = useStaffSwitch(orgId, deviceId, open);
  const [picked, setPicked] = useState<StaffSwitchEntry | null>(null);
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  // A phone in landscape (~360 px tall) can't fit the stacked PIN step: keypad beside the face instead (device test I-2).
  const short = useShortScreen();

  // The staff list itself can say the tablet is unknown: same set-up-again path as a failed PIN.
  const listCode = staff.error instanceof ApiError ? staff.error.code : null;
  const gone = useRef(onDeviceGone);
  gone.current = onDeviceGone;
  useEffect(() => {
    if (!open || listCode !== 'DEVICE_UNKNOWN') return;
    toast.error(friendlyMessage(listCode));
    gone.current();
  }, [open, listCode]);

  useEffect(() => {
    if (open) return;
    setPicked(null);
    setPin('');
    setMessage(null);
    setLocked(false);
    setBusy(false);
  }, [open]);

  const submit = async (digits: string) => {
    if (!picked || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<{ actingToken: string; expiresAt: number }>(`/orgs/${encodeURIComponent(orgId)}/acting`, {
        method: 'POST',
        json: { deviceId, teacherUserId: picked.userId, pin: digits },
      });
      await setActingToken({ token: r.actingToken, expiresAt: r.expiresAt, teacherUserId: picked.userId, teacherName: picked.name });
      toast.success(`Hi ${picked.name} 👋`);
      onSwitched();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'INTERNAL';
      setPin('');
      if (code === 'DEVICE_UNKNOWN') {
        // Not a wrong PIN: the tablet's registration is gone on the server.
        toast.error(friendlyMessage(code));
        onDeviceGone();
        return;
      }
      if (code === 'PIN_LOCKED') {
        setLocked(true);
        setMessage(LOCKED_COPY);
      } else {
        if (code === 'FORBIDDEN') setShake((n) => n + 1);
        setMessage(code === 'FORBIDDEN' ? WRONG_PIN_COPY : friendlyMessage(code));
      }
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    setPicked(null);
    setPin('');
    setMessage(null);
    setLocked(false);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={picked ? `${picked.name}, enter your PIN` : "Who's teaching?"}
      footer={
        picked && short ? undefined : picked ? (
          <Button variant="ghost" fullWidth onClick={back}>
            Pick someone else
          </Button>
        ) : acting ? (
          <Button variant="white" fullWidth onClick={onEndShift}>
            End shift
          </Button>
        ) : undefined
      }
    >
      {picked && short ? (
        <div data-layout="compact" className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 pb-1">
          <div className="flex min-w-0 flex-col items-center gap-2 text-center">
            <Avatar name={picked.name} size={48} ring />
            <p role={message ? 'alert' : undefined} className="min-h-[20px] text-[14px] font-semibold text-danger">
              {message}
            </p>
            <Button variant="ghost" size="sm" onClick={back}>
              Pick someone else
            </Button>
          </div>
          <PinPad compact value={pin} onChange={setPin} onComplete={(d) => void submit(d)} shake={shake} disabled={busy || locked} label={`${picked.name}'s PIN`} />
        </div>
      ) : picked ? (
        <div className="flex flex-col items-center gap-4 pb-2 pt-2">
          <Avatar name={picked.name} size={64} ring />
          <p role={message ? 'alert' : undefined} className="min-h-[24px] text-center text-[15px] font-semibold text-danger">
            {message}
          </p>
          <PinPad value={pin} onChange={setPin} onComplete={(d) => void submit(d)} shake={shake} disabled={busy || locked} label={`${picked.name}'s PIN`} />
        </div>
      ) : staff.isPending ? (
        <Skeleton shape="block" />
      ) : staff.isError ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <p className="text-[15px] text-mutedText">{friendlyMessage(staff.error instanceof ApiError ? staff.error.code : 'INTERNAL')}</p>
          <Button size="sm" onClick={() => void staff.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 pb-2 pt-1 min-[520px]:grid-cols-3">
          {(staff.data ?? []).map((s) => {
            const current = s.userId === acting?.teacherUserId;
            return (
              <button
                key={s.userId}
                type="button"
                disabled={!s.hasPin}
                onClick={() => setPicked(s)}
                className={clsx(
                  'flex min-h-[116px] flex-col items-center justify-center gap-1.5 rounded-btn border-btn border-ink px-2 py-3 text-center shadow-chunky transition-colors active:translate-y-[3px] active:shadow-none disabled:opacity-55 disabled:shadow-none',
                  current ? 'bg-sun' : 'bg-white',
                )}
              >
                <Avatar name={s.name} size={56} />
                <span className="max-w-full truncate text-[16px] font-semibold leading-tight text-ink">{s.name || 'Teacher'}</span>
                {!s.hasPin ? <span className="text-[12px] text-mutedText">No PIN yet</span> : current ? <span className="text-[12px] text-ink">Teaching now</span> : null}
              </button>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
