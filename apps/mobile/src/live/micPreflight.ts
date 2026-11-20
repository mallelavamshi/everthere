/**
 * Mic pre-flight (task 26c round 2, from the phone test). On a fresh install the first call used to open Android's
 * RECORD_AUDIO dialog from inside the Napster SDK, while our connect timeout was already running: a parent who took
 * ~50 s to answer got "the call couldn't connect". So the permission is settled first, before any session is
 * created or the SDK connects:
 *
 * - `granted`: already allowed (fast path: the Permissions API says so, no capture and no prompt), or allowed now
 *   through a getUserMedia({ audio: true }) whose tracks are stopped at once (Capacitor's WebChromeClient shows the
 *   system dialog for it).
 * - `denied`: the person refused (or it was refused before): the call shows our microphone screen (MIC_BLOCKED).
 * - `unavailable`: no mic API, no device or a busy one: carry on and let the SDK report what it finds.
 */
export type MicCheck = 'granted' | 'denied' | 'unavailable';

const REFUSED = new Set(['NotAllowedError', 'SecurityError', 'PermissionDeniedError']);

export async function preflightMic(nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator): Promise<MicCheck> {
  const md = nav?.mediaDevices;
  if (!md?.getUserMedia) return 'unavailable';
  try {
    const status = await nav?.permissions?.query({ name: 'microphone' as PermissionName });
    if (status?.state === 'granted') return 'granted';
  } catch {
    // Some WebViews do not know the 'microphone' permission name: ask below.
  }
  try {
    const stream = await md.getUserMedia({ audio: true });
    stream?.getTracks?.().forEach((t) => t.stop());
    return 'granted';
  } catch (e) {
    const name = (e as { name?: unknown } | null)?.name;
    return typeof name === 'string' && REFUSED.has(name) ? 'denied' : 'unavailable';
  }
}
