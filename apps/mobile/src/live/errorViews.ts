import type { AssetKey } from '../assets/manifest';

export interface ErrorViewInput {
  mode: 'test' | 'child';
  childName?: string;
  parentTitle?: string;
}

export interface ErrorView {
  asset: AssetKey;
  title: string;
  body: string;
  /** Offer "Try again" (a fresh begin()). */
  retry: boolean;
}

/** Friendly full-screen copy for every way a live session can fail to start or be cut short. Never raw error text. */
export function errorView(code: string | undefined, who: ErrorViewInput): ErrorView {
  const child = who.childName?.trim() || 'This little one';
  switch (code) {
    case 'AVATARS_BUSY':
      return {
        asset: 'empty.avatarsBusy',
        title: 'All our avatars are busy hugging…',
        body: 'So many little ones need a cuddle right now. Give it a minute and try again 💛',
        retry: true,
      };
    case 'RESTING':
      return {
        asset: 'empty.resting',
        title: 'EverThere is taking a little rest',
        body: "Comfort calls are paused for now. Please try again a bit later. We'll be right here 💛",
        retry: true,
      };
    case 'SESSION_ACTIVE':
      return who.mode === 'test'
        ? { asset: 'empty.avatarsBusy', title: 'A test call is already going', body: 'Close the other call first, then try again.', retry: false }
        : {
            asset: 'empty.avatarsBusy',
            title: `${child} already has a comfort call going`,
            body: 'Only one comfort call can run at a time. Check the other tablet or phone, then try again.',
            retry: false,
          };
    case 'NETWORK':
      return {
        asset: 'empty.offline',
        title: "We can't reach EverThere",
        body: 'Check the Wi-Fi or mobile data, then try again 💛',
        retry: true,
      };
    case 'CONNECT_TIMEOUT':
      return {
        asset: 'empty.offline',
        title: "The call couldn't connect",
        body: 'The connection seems slow right now. Check the Wi-Fi, then try again 💛',
        retry: true,
      };
    case 'MIC_BLOCKED':
      return {
        asset: 'onboarding.avatarVoice',
        title: 'We need the microphone',
        body: `So ${who.parentTitle?.trim() || 'the avatar'} can hear, EverThere needs the microphone. Open your phone's Settings → Apps → EverThere → Permissions → Microphone, choose "Allow while using the app", then come back and tap Try again.`,
        retry: true,
      };
    case 'INVALID':
      // The API refused the start (e.g. the avatar isn't ready, or something in the setup needs a look).
      return who.mode === 'test'
        ? {
            asset: 'empty.error',
            title: "This test call can't start just yet",
            body: 'Your avatar may still be getting ready. Give it a moment, then try again 💛',
            retry: true,
          }
        : {
            asset: 'empty.error',
            title: `${who.childName?.trim() ? `${who.childName.trim()}'s` : 'This'} call can't start just yet`,
            body: `Something in the setup for ${who.parentTitle?.trim() || 'the avatar'} needs a quick look. Try again in a moment, or ask a parent to check the app 💛`,
            retry: true,
          };
    case 'NO_CREDITS':
      return {
        asset: 'empty.resting',
        title: 'Our call minutes are used up for now',
        body: "EverThere has used all of its comfort-call minutes for the moment. We'll be back soon. Thank you for your patience 💛",
        retry: false,
      };
    default:
      return {
        asset: 'empty.error',
        title: "Hmm, that call didn't connect",
        body: 'Something got tangled on our end. Give it another try.',
        retry: true,
      };
  }
}
