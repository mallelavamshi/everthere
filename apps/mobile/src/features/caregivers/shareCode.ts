import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';

/** "Leo", "Leo & Mia", "Leo, Mia & Zoe". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

export type ShareKind = 'home_caregiver' | 'co_parent' | 'staff' | 'enrollment';

/** The message that goes out with a code. `names` are the children, except for `staff` and `enrollment`, where it is the daycare's name. */
export function shareText(kind: ShareKind, names: string[], code: string): string {
  const who = joinNames(names);
  switch (kind) {
    case 'co_parent':
      return `Join me on EverThere to comfort ${who} together 💛 Code: ${code}`;
    case 'staff':
      return `Join ${who} on EverThere as a teacher 💛 Code: ${code}`;
    case 'enrollment':
      return `${who} invites you to EverThere 💛 Code: ${code}`;
    default:
      return `Join me on EverThere to comfort ${who} 💛 Code: ${code}`;
  }
}

/** Clipboard API first, then a hidden-textarea execCommand for webviews without it. Resolves true when copied. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

const isCancel = (e: unknown) => /abort|cancel/i.test(`${(e as { name?: string })?.name ?? ''} ${(e as { message?: string })?.message ?? ''}`);

/** Native share sheet, then navigator.share, then copy. Returns how it went so the caller can toast. */
export async function shareInvite(text: string): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  try {
    if (Capacitor.isNativePlatform()) {
      await Share.share({ text });
      return 'shared';
    }
    if (typeof navigator.share === 'function') {
      await navigator.share({ text });
      return 'shared';
    }
  } catch (e) {
    if (isCancel(e)) return 'cancelled';
  }
  return (await copyText(text)) ? 'copied' : 'failed';
}
