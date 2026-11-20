import { Button, toast } from '../../ui';
import { copyText, shareInvite } from './shareCode';

const DAY = 86_400_000;

/** "Good for 6 more days", "Good until tomorrow", "Expired"; the old flat "Good for 7 days" when no expiry is known. */
export function lifeText(expiresAt?: number | string, now = Date.now()): string {
  const at = expiresAt === undefined ? NaN : typeof expiresAt === 'number' ? expiresAt : Date.parse(expiresAt);
  if (!Number.isFinite(at)) return 'Good for 7 days';
  const days = Math.ceil((at - now) / DAY);
  if (days <= 0) return 'This code has expired';
  return days === 1 ? 'Good until tomorrow' : `Good for ${days} more days`;
}

/** An invite code, big, with a spoken version for screen readers (letters one by one) and its 7-day life. */
export function CodeDisplay({ code, lead = 'Share this code with them', expiresAt }: { code: string; lead?: string; expiresAt?: number | string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-4 text-center">
      <p className="text-[15px] text-mutedText">{lead}</p>
      <p className="sr-only">Your invite code is {code.split('').join(' ')}</p>
      <p aria-hidden="true" className="rounded-card border-card border-line bg-white px-5 py-4 text-[40px] font-semibold tracking-[0.3em] text-ink">
        {code}
      </p>
      <p className="text-[14px] text-mutedText">{lifeText(expiresAt)}</p>
    </div>
  );
}

/** Share (native sheet, then copy fallback) and Copy for a ready-made message. */
export function ShareButtons({ text }: { text: string }) {
  const onShare = async () => {
    const r = await shareInvite(text);
    if (r === 'copied') toast.success('Copied! Paste it anywhere to share 💛');
    else if (r === 'failed') toast.error("We couldn't share that. Try Copy instead.");
  };
  const onCopy = async () => {
    if (await copyText(text)) toast.success('Copied!');
    else toast.error("We couldn't copy that. Please try again.");
  };
  return (
    <div className="flex gap-2">
      <Button fullWidth onClick={() => void onShare()}>Share</Button>
      <Button fullWidth variant="white" onClick={() => void onCopy()}>Copy</Button>
    </div>
  );
}
