import type { NapsterCompanionApiConfig, NapsterCompanionApiInstance } from '@touchcastllc/napster-companion-api';
import type { LiveEvent } from './events';
import { liveMark } from './timing';

// A thin adapter over the Napster Companion SDK, so the hook can run against the real SDK, the DEV fake
// (fakeSdk.ts) or a unit-test double. Shapes follow docs/notes/napster-events.md.

export type SdkStatus = 'entry' | 'loading' | 'permissionPending' | 'permissionDismissed' | 'permissionBlocked' | 'readyAudio' | 'readyVideo';

export interface LiveCallbacks {
  onData?: (msg: LiveEvent) => void;
  onAvatarReady?: (ready?: boolean) => void;
  onSessionStatusChange?: (status: SdkStatus) => void;
  onInactivityStatusChange?: (inactive: boolean) => void;
  onDestroy?: () => void;
  onError?: (err: Error) => void;
}

/** The only commands we ever send. START_VIDEO is deliberately not representable: the child camera is never sent. */
export type LiveCommand =
  | { type: 'send_message'; data: { text: string; role: 'system' | 'user'; trigger_response: boolean } }
  | { type: 'send_function_output'; data: { call_id: string; output: unknown; delay: boolean } };

export interface LiveInstance {
  destroy(): void;
  sendCommand(cmd: LiveCommand): void;
  muteMic(): void;
  unmuteMic(): void;
  setAudioVolume(v: number): void;
  /** Reset the SDK's own inactivity countdown, if it ever runs. */
  keepAlive?(): void;
}

export interface LiveSdk {
  init(getToken: () => Promise<string>, opts: LiveCallbacks & { mountContainer: HTMLElement }): Promise<LiveInstance>;
}

/**
 * Napster config for a live session.
 * - Inline in our hero container, rectangle view (we round the container ourselves).
 * - inactiveTimeout disabled: the SDK otherwise tears the session down after ~90 s of child silence
 *   (60 s + 30 s countdown, notes section 3). `enabled:false` skips its timer entirely (checked in the 2.0.0
 *   bundle: the timer is only armed when `features.inactiveTimeout.enabled` is truthy). Our own 10-minute cap rules.
 * - Built-in controls and loading chrome off: LiveSession draws its own.
 * - Nothing that opens the camera: faceTracking and screenShare off, and we never send START_VIDEO.
 */
export function napsterConfig(mountContainer: HTMLElement, cb: LiveCallbacks): Partial<NapsterCompanionApiConfig> {
  return {
    layout: { type: 'inline', mountContainer },
    style: { view: 'rectangle' },
    features: {
      inactiveTimeout: { enabled: false },
      controls: { enabled: false },
      loadingIndicator: { enabled: false },
      faceTracking: { enabled: false },
      screenShare: { enabled: false },
      pictureInPicture: { enabled: false },
    },
    onData: cb.onData as NapsterCompanionApiConfig['onData'],
    onAvatarReady: cb.onAvatarReady,
    onSessionStatusChange: cb.onSessionStatusChange,
    onInactivityStatusChange: cb.onInactivityStatusChange,
    onDestroy: cb.onDestroy,
    onError: cb.onError,
  };
}

/**
 * The SDK sets `navigator.mediaSession.metadata = new MediaMetadata(...)` when the avatar stream arrives, in the same
 * expression that starts playback. Older WebViews (124 on the test emulator) lack MediaMetadata, so that threw an
 * uncaught ReferenceError (device test M-3). Minimal stand-ins, defined only when missing; real ones are never replaced.
 */
export function ensureMediaSessionShim(): void {
  const g = globalThis as { MediaMetadata?: unknown };
  if (typeof g.MediaMetadata === 'undefined') {
    g.MediaMetadata = class MediaMetadata {
      title = '';
      artist = '';
      album = '';
      artwork: unknown[] = [];
      constructor(init: { title?: string; artist?: string; album?: string; artwork?: unknown[] } = {}) {
        Object.assign(this, init);
      }
    };
  }
  if (typeof navigator !== 'undefined' && !navigator.mediaSession) {
    Object.defineProperty(navigator, 'mediaSession', {
      configurable: true,
      value: { metadata: null, playbackState: 'none', setActionHandler() {}, setPositionState() {} },
    });
  }
}

type SdkModule = typeof import('@touchcastllc/napster-companion-api');
let sdkModule: Promise<SdkModule> | null = null;

/**
 * Start loading the SDK bundle now (task 31): the call screen kicks this off at the tap, so it loads while the mic
 * check runs instead of after it. A failed load is forgotten so the next call tries again.
 */
export function preloadNapsterSdk(): Promise<SdkModule> {
  if (!sdkModule) {
    sdkModule = import('@touchcastllc/napster-companion-api');
    sdkModule.catch(() => {
      sdkModule = null;
    });
  }
  return sdkModule;
}

/** The real SDK, loaded on first use so its bundle stays out of the start-up chunk. */
export const napsterSdk: LiveSdk = {
  async init(getToken, { mountContainer, ...cb }) {
    ensureMediaSessionShim();
    const { NapsterCompanionApiSdk } = await preloadNapsterSdk();
    liveMark('sdk bundle ready');
    const inst: NapsterCompanionApiInstance = await NapsterCompanionApiSdk.init(getToken, napsterConfig(mountContainer, cb));
    return {
      destroy: () => inst.destroy(),
      // Our LiveCommand types use the DataChannelMessageType string values ("send_message", "send_function_output").
      sendCommand: (cmd) => inst.sendCommand(cmd as unknown as Parameters<NapsterCompanionApiInstance['sendCommand']>[0]),
      muteMic: () => inst.muteMic(),
      unmuteMic: () => inst.unmuteMic(),
      setAudioVolume: (v) => inst.setAudioVolume(v),
      keepAlive: () => inst.updateFeatureConfig('inactiveTimeout', { enabled: false }),
    };
  },
};
