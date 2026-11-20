import { img, type AssetKey } from '../../assets/manifest';
import { Illustration } from '../../ui';

const isAsset = (k: string | null | undefined): k is AssetKey => !!k && k in img;

/** A classroom's badge: the curated art when it has an assetKey, else its emoji, else an apple. Always decorative. */
export function Emblem({ assetKey, emoji, size }: { assetKey: string | null; emoji: string | null; size: number }) {
  if (isAsset(assetKey)) return <Illustration asset={assetKey} size={size} alt="" priority />;
  return (
    <span aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.55 }} className="grid shrink-0 place-items-center rounded-full bg-sun/40 leading-none">
      {emoji ?? '🍎'}
    </span>
  );
}
