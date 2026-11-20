import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { MeResponse } from '@everthere/shared';
import { availableRoles, homeFor, validDevice, type Home, type Role } from '../lib/role';
import { emitActingReset } from '../lib/actingReset';
import { resetSwitchPrompt } from '../lib/switchPrompt';
import { sessionReady } from '../lib/sessionHold';
import { clearActingToken, clearDevice, getDevice, getRolePref, setDevice, setRolePref, type DeviceRegistration } from '../lib/storage';
import { ProfileTriggerContext } from '../ui/profileContext';
import { ProfileSheet } from './ProfileSheet';
import { Splash } from './Splash';

interface Ctx {
  me: MeResponse;
  /** This device's tablet registration, only when it is for one of this person's orgs (see role.validDevice). */
  device: DeviceRegistration | null;
  roles: Role[];
  home: Home;
  /** Remember a freshly registered shared tablet right away (no restart), which also makes caregiver the first role. */
  registerDevice: (d: DeviceRegistration) => void;
  /** The API no longer knows this tablet: forget the registration (and who was teaching) so it can be set up again. */
  unregisterDevice: () => void;
}
const SessionCtx = createContext<Ctx | null>(null);

export function useSession(): Ctx {
  const c = useContext(SessionCtx);
  if (!c) throw new Error('useSession outside SessionProvider');
  return c;
}

const roleOfPath = (p: string): Role | undefined => (['parent', 'admin', 'caregiver'] as const).find((r) => p === `/${r}` || p.startsWith(`/${r}/`));

/** Loads the on-device role preference and tablet registration, then exposes the signed-in person + profile sheet. */
export function SessionProvider({ me, children }: { me: MeResponse; children: ReactNode }) {
  const [prefs, setPrefs] = useState<{ pref: Role | null; device: DeviceRegistration | null } | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    let live = true;
    // A flow that signs in and then still registers this device (the demo teacher) holds the read until it is done.
    void sessionReady()
      .then(() => Promise.all([getRolePref(), getDevice()]))
      .then(([pref, device]) => live && setPrefs({ pref, device }));
    return () => {
      live = false;
    };
  }, []);

  // A registration for an org this person is not staff of is someone else's (e.g. "Peek as a Teacher" on this phone):
  // it never counts, and it is forgotten so it can't come back for a later account.
  const device = prefs ? validDevice(me, prefs.device) : null;
  const stale = !!prefs?.device && !device;
  useEffect(() => {
    if (!stale) return;
    void clearDevice();
    void clearActingToken();
    setPrefs((p) => (p ? { ...p, device: null } : p));
  }, [stale]);

  const registerDevice = useCallback((device: DeviceRegistration) => {
    void setDevice(device);
    void setRolePref('caregiver');
    setPrefs((p) => (p ? { pref: 'caregiver', device } : p));
  }, []);

  const unregisterDevice = useCallback(() => {
    resetSwitchPrompt();
    emitActingReset();
    void clearDevice();
    void clearActingToken();
    setPrefs((p) => (p ? { ...p, device: null } : p));
  }, []);

  const value = useMemo<Ctx | null>(
    () =>
      prefs ? { me, device, roles: availableRoles(me, { device }), home: homeFor(me, prefs.pref, { device }), registerDevice, unregisterDevice } : null,
    [me, prefs, device, registerDevice, unregisterDevice],
  );

  const switchRole = useCallback(
    (role: Role) => {
      void setRolePref(role);
      setPrefs((p) => (p ? { ...p, pref: role } : p));
      setProfileOpen(false);
      navigate(homeFor(me, role, { device }), { replace: true });
    },
    [me, navigate, device],
  );

  const trigger = useMemo(() => ({ name: me.user.name, open: () => setProfileOpen(true) }), [me.user.name]);

  if (!value) return <Splash />;
  return (
    <SessionCtx.Provider value={value}>
      <ProfileTriggerContext.Provider value={trigger}>
        {children}
        <ProfileSheet
          open={profileOpen}
          onClose={() => setProfileOpen(false)}
          me={me}
          current={roleOfPath(pathname)}
          device={device}
          onSwitchRole={switchRole}
        />
      </ProfileTriggerContext.Provider>
    </SessionCtx.Provider>
  );
}
