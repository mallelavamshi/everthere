// iOS build (Capacitor iOS, WKWebView): platform-specific behaviour and copy. Everything here runs in jsdom with
// Capacitor's platform mocked; nothing has run on a real iPhone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let platform = 'ios';
vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return {
    ...actual,
    Capacitor: { ...actual.Capacitor, getPlatform: () => platform, isNativePlatform: () => platform !== 'web' },
  };
});

const handlers: Record<string, (e?: unknown) => void> = {};
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (name: string, cb: (e?: unknown) => void) => {
      handlers[name] = cb;
      return { remove: async () => { delete handlers[name]; } };
    }),
    exitApp: vi.fn(),
  },
}));

import { appPlatform } from '../src/lib/platform';
import { onAppBackground } from '../src/lib/native';
import { errorView } from '../src/live/errorViews';
import { friendlyClerkError } from '../src/features/onboarding/lib';
import { NOTIFICATION_PRIMER_BODY } from '../src/shell/AlertsBridge';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  platform = 'ios';
});
afterEach(() => {
  for (const k of Object.keys(handlers)) delete handlers[k];
});

describe('appPlatform', () => {
  it('reports ios, android or web from Capacitor', () => {
    expect(appPlatform()).toBe('ios');
    platform = 'android';
    expect(appPlatform()).toBe('android');
    platform = 'web';
    expect(appPlatform()).toBe('web');
  });
  it('treats anything unknown as web', () => {
    platform = 'electron';
    expect(appPlatform()).toBe('web');
  });
});

describe('onAppBackground on iOS', () => {
  it('an inactive app (a permission alert, Control Center) is not backgrounding: appStateChange isActive:false is ignored', async () => {
    const cb = vi.fn();
    const off = onAppBackground(cb);
    await flush();
    handlers.appStateChange?.({ isActive: false });
    expect(cb).not.toHaveBeenCalled();
    off();
  });
  it('real backgrounding (pause = didEnterBackground) calls back', async () => {
    const cb = vi.fn();
    const off = onAppBackground(cb);
    await flush();
    handlers.pause!();
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });
  it('on Android, appStateChange isActive:false still counts (pause is the permission-dialog overlay there)', async () => {
    platform = 'android';
    const cb = vi.fn();
    const off = onAppBackground(cb);
    await flush();
    handlers.appStateChange!({ isActive: false });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(handlers.pause).toBeUndefined();
    off();
  });
});

describe('iOS copy', () => {
  const who = { mode: 'child' as const, childName: 'Mia', parentTitle: 'Mom' };
  it('MIC_BLOCKED on iOS points at Settings → EverThere → Microphone, not Android app permissions', () => {
    const v = errorView('MIC_BLOCKED', { ...who, platform: 'ios' });
    expect(v.body).toMatch(/Settings/);
    expect(v.body).toMatch(/EverThere/);
    expect(v.body).toMatch(/Microphone/);
    expect(v.body).not.toMatch(/Apps →|Permissions|Allow while using/);
    expect(v.retry).toBe(true);
  });
  it('MIC_BLOCKED on Android keeps the Android path', () => {
    const v = errorView('MIC_BLOCKED', { ...who, platform: 'android' });
    expect(v.body).toMatch(/Apps → EverThere → Permissions → Microphone/);
  });
  it('MIC_BLOCKED on the web points at the address bar', () => {
    const v = errorView('MIC_BLOCKED', { ...who, platform: 'web' });
    expect(v.body).toMatch(/address bar/);
  });
  it('the notification primer does not say Android will ask', () => {
    expect(NOTIFICATION_PRIMER_BODY).not.toMatch(/Android/);
    expect(NOTIFICATION_PRIMER_BODY).toMatch(/ask you to allow/);
  });
  it('an unsupported security check does not tell an iPhone user to update Android System WebView', () => {
    const m = friendlyClerkError({ errors: [{ code: 'protect_check_unsupported_environment' }] }).message;
    expect(m).toMatch(/security check/i);
    expect(m).not.toMatch(/Android/);
  });
});
