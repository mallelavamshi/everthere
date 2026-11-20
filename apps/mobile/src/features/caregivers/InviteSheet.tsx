import { useEffect, useRef, useState } from 'react';
import type { ChildView } from '@everthere/shared';
import { api, ApiError, friendlyMessage } from '../../lib/api';
import { haptics } from '../../lib/native';
import { Avatar, Button, Chip, Sheet } from '../../ui';
import { CodeDisplay, ShareButtons } from './CodeDisplay';
import { shareText } from './shareCode';

export type InviteVariant = 'home_caregiver' | 'co_parent' | 'staff';

export interface InviteSheetProps {
  open: boolean;
  onClose: () => void;
  variant: InviteVariant;
  /** Children of the family being invited into (not used by the `staff` variant). */
  kids?: ChildView[];
  /** The child the Caregivers tab is showing: names the co-parent share text and picks the family. */
  focusChild?: ChildView;
  /** `staff` variant: the daycare a teacher is invited to join, and its name for the share text. */
  orgId?: string;
  orgName?: string;
}

interface Invite {
  code: string;
  expiresAt: number | string;
}

const NO_KIDS: ChildView[] = [];

export function InviteSheet({ open, onClose, variant, kids = NO_KIDS, focusChild, orgId, orgName }: InviteSheetProps) {
  const [picked, setPicked] = useState<string[]>([]);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState<string[]>([]);

  // Keyed by ids so a new array with the same children doesn't reset the sheet.
  const kidsKey = kids.map((k) => k.id).join(',');
  const inFlight = useRef(false);
  const token = useRef(0);

  useEffect(() => {
    if (open) {
      token.current++;
      inFlight.current = false;
      setPicked(variant === 'home_caregiver' && kids.length === 1 ? [kids[0]!.id] : []);
      setInvite(null);
      setError(null);
      setBusy(false);
    }
  }, [open, variant, kidsKey]);

  const familyId = (focusChild ?? kids[0])?.familyId;
  const isNanny = variant === 'home_caregiver';
  const isStaff = variant === 'staff';
  const canGenerate = isStaff ? !!orgId : !!familyId && (!isNanny || picked.length > 0);

  const generate = async () => {
    if (!canGenerate || inFlight.current) return;
    inFlight.current = true;
    const mine = token.current;
    setBusy(true);
    setError(null);
    try {
      const res = isStaff
        ? await api<Invite>(`/orgs/${encodeURIComponent(orgId!)}/invites/staff`, { method: 'POST' })
        : await api<Invite>('/invites', { method: 'POST', json: isNanny ? { type: variant, familyId, childIds: picked } : { type: variant, familyId } });
      if (mine !== token.current) return;
      setNames(isStaff ? [orgName ?? 'our daycare'] : isNanny ? kids.filter((c) => picked.includes(c.id)).map((c) => c.name) : [focusChild?.name ?? kids[0]?.name ?? ''].filter(Boolean));
      setInvite(res);
      haptics.success();
    } catch (e) {
      if (mine === token.current) setError(friendlyMessage(e instanceof ApiError ? e.code : 'INTERNAL'));
    } finally {
      if (mine === token.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  };

  const text = invite ? shareText(variant, names, invite.code) : '';

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isStaff ? 'Invite a teacher' : isNanny ? 'Invite a nanny or grandparent' : 'Invite a co-parent'}
      footer={
        invite ? (
          <ShareButtons text={text} />
        ) : (
          <Button fullWidth loading={busy} disabled={!canGenerate} onClick={() => void generate()}>
            {error ? 'Try again' : 'Generate code'}
          </Button>
        )
      }
    >
      {invite ? (
        <CodeDisplay code={invite.code} expiresAt={invite.expiresAt} />
      ) : (
        <div className="flex flex-col gap-3 py-2">
          {isStaff ? (
            <p className="text-[15px] text-ink">
              We will make a one-time code for a new teacher to join {orgName ?? 'your daycare'}. They set their own PIN when they join.
            </p>
          ) : isNanny ? (
            <>
              <p className="text-[15px] text-ink">Which little ones can they comfort?</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Choose children">
                {kids.map((c) => (
                  <Chip
                    key={c.id}
                    selected={picked.includes(c.id)}
                    icon={<Avatar src={c.photoUrl} emoji={c.photoUrl ? undefined : c.name.charAt(0).toUpperCase()} size={24} />}
                    onClick={() => setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))}
                  >
                    {c.name}
                  </Chip>
                ))}
              </div>
            </>
          ) : (
            <p className="text-[15px] text-ink">
              They can set up their own avatar for {focusChild?.name ?? 'your little one'}, so there are two of you ready to comfort.
            </p>
          )}
          {error ? (
            <p role="alert" className="rounded-card bg-flag p-3 text-[14px] text-ink">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}
