import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { AssetKey } from '../../assets/manifest';
import { haptics } from '../../lib/native';
import { Illustration } from '../../ui';

export const EMBLEMS = ['butterflies', 'bees', 'ladybugs', 'owls', 'turtles', 'rainbows', 'stars', 'sunflowers'] as const;
export type Emblem = (typeof EMBLEMS)[number];
export const emblemLabel = (e: Emblem) => e.charAt(0).toUpperCase() + e.slice(1);
export const emblemKey = (e: Emblem): AssetKey => `classroom.${e}`;
/** "classroom.owls" -> "owls", or undefined for anything that is not one of the curated badges. */
export const emblemOf = (assetKey: string | null | undefined): Emblem | undefined => EMBLEMS.find((e) => emblemKey(e) === assetKey);

/**
 * The classroom badge grid (onboarding's first classroom, and the admin's create/edit sheet).
 * `extra` renders one more radio before the eight badges, for a classroom that was made with an emoji.
 */
export function EmblemPicker({
  value,
  onChange,
  extra,
}: {
  value: Emblem | undefined;
  onChange: (e: Emblem) => void;
  extra?: ReactNode;
}) {
  return (
    <div role="radiogroup" aria-label="Classroom badge" className="grid grid-cols-4 gap-2">
      {extra}
      {EMBLEMS.map((em) => {
        const on = em === value;
        return (
          <button
            key={em}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={emblemLabel(em)}
            onClick={() => {
              onChange(em);
              haptics.light();
            }}
            className={clsx(
              'flex min-h-[88px] flex-col items-center justify-center gap-1 rounded-card border-2 p-1.5',
              on ? 'border-ink bg-sun shadow-chunky' : 'border-line bg-white',
            )}
          >
            <Illustration asset={emblemKey(em)} size={52} alt="" />
            <span aria-hidden="true" className={clsx('text-[12px]', on ? 'font-semibold' : 'text-mutedText')}>
              {emblemLabel(em)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
