import { useEffect, useState } from 'react';
import clsx from 'clsx';

export interface AvatarProps {
  src?: string;
  emoji?: string;
  /** Accessible name. Omit for a decorative avatar. */
  name?: string;
  size?: number;
  ring?: boolean;
  className?: string;
}

export function Avatar({ src, emoji, name, size = 48, ring, className }: AvatarProps) {
  // A signed photo URL can expire (or fail to load): fall back to the emoji / initial quietly, never a broken-image icon.
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const shown = src && !failed ? src : undefined;
  const a11y = name ? { role: 'img' as const, 'aria-label': name } : { 'aria-hidden': true as const };
  return (
    <span
      {...a11y}
      style={{ width: size, height: size, fontSize: size * 0.55 }}
      className={clsx(
        'inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-white leading-none',
        ring ? 'border-btn border-ink shadow-focus' : 'border-2 border-line',
        !shown && !emoji && 'bg-lilac',
        className,
      )}
    >
      {shown ? (
        <img src={shown} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      ) : emoji ? (
        <span aria-hidden="true">{emoji}</span>
      ) : (
        <span aria-hidden="true" style={{ fontSize: size * 0.4 }} className="font-semibold text-ink">
          {(name ?? '?').trim().charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}
