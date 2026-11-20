import { useState } from 'react';
import { useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import type { MeResponse } from '@everthere/shared';
import { Avatar, Badge, Button, Segmented, Sheet, toast } from '../ui';
import { availableRoles, type Role } from '../lib/role';
import { signOutAndClear } from '../lib/session';
import type { DeviceRegistration } from '../lib/storage';

const LABELS: Record<Role, string> = { parent: 'Parent', admin: 'Daycare admin', caregiver: 'Caregiver' };

export interface ProfileSheetProps {
  open: boolean;
  onClose: () => void;
  me: MeResponse;
  /** The role whose screens are showing now. */
  current?: Role;
  /** This device's validated tablet registration (SessionProvider). */
  device?: DeviceRegistration | null;
  onSwitchRole: (role: Role) => void;
}

export function ProfileSheet({ open, onClose, me, current, device, onSwitchRole }: ProfileSheetProps) {
  const { signOut } = useClerk();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const roles = availableRoles(me, { device });

  async function doSignOut() {
    setBusy(true);
    // Whatever the outcome, nothing from this person may linger on the device.
    const ok = await signOutAndClear(signOut, qc);
    if (!ok) toast.error("We couldn't sign you out just now. Please try again.");
    setBusy(false);
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Your profile">
      <div className="flex items-center gap-3 pb-4">
        <Avatar name={me.user.name} size={56} ring />
        <div className="min-w-0">
          <p className="truncate text-[18px] font-semibold text-ink">{me.user.name}</p>
          <p className="truncate text-[14px] text-mutedText">{me.user.email}</p>
          {me.user.isDemo ? <Badge tone="sun" className="mt-1">Demo account</Badge> : null}
        </div>
      </div>

      {roles.length > 1 ? (
        <div className="pb-4">
          <p className="mb-2 text-[14px] font-semibold text-ink">Switch view</p>
          <Segmented<Role>
            aria-label="Switch view"
            options={roles.map((r) => ({ value: r, label: LABELS[r] }))}
            value={current && roles.includes(current) ? current : roles[0]!}
            onChange={onSwitchRole}
          />
        </div>
      ) : null}

      <Button variant="white" fullWidth loading={busy} onClick={doSignOut}>
        Sign out
      </Button>
    </Sheet>
  );
}
