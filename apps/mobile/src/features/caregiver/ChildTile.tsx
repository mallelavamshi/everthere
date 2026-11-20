import clsx from 'clsx';
import type { RosterTile } from '@everthere/shared';
import { Avatar, Badge, Card } from '../../ui';

/** One child on the roster, whether it came from a classroom roster or a nanny's own list. */
export type TileModel = Pick<RosterTile, 'name' | 'photoUrl' | 'status' | 'readyAvatars'> & { key: string; childId?: string };

export const badgeFor = (t: TileModel): { tone: 'mint' | 'neutral'; text: string } => {
  if (t.status === 'ready') {
    const titles = t.readyAvatars.map((a) => a.parentTitle).join(' + ');
    return { tone: 'mint', text: t.readyAvatars.length > 1 ? `✨ ${titles}` : `✨ ${titles} ready` };
  }
  if (t.status === 'setup_pending') return { tone: 'neutral', text: '⏳ Setup pending' };
  return { tone: 'neutral', text: '✉️ Invite sent' };
};

/** Why a tile can't start a call yet, as a sentence for a gentle toast. */
export const whyNot = (t: TileModel): string =>
  t.status === 'invite_sent' ? `Waiting for ${t.name}'s family to join` : `${t.name}'s family is still setting up`;

export function ChildTile({ tile, onTap }: { tile: TileModel; onTap: (t: TileModel) => void }) {
  const ready = tile.status === 'ready';
  const badge = badgeFor(tile);
  return (
    <Card
      lift={ready}
      onClick={() => onTap(tile)}
      aria-disabled={ready ? undefined : true}
      className={clsx('flex min-h-[148px] flex-col items-center justify-center gap-1.5 px-2 py-4 text-center', !ready && '!border-dashed !bg-cream')}
    >
      <Avatar src={tile.photoUrl} size={76} ring={ready} className={ready ? undefined : 'opacity-60'} />
      <span className="max-w-full truncate text-[20px] font-semibold leading-tight text-ink">{tile.name}</span>
      <Badge tone={badge.tone}>{badge.text}</Badge>
    </Card>
  );
}
