import clsx from 'clsx';
import { img, imgSrcSet, type AssetKey } from '../assets/manifest';
import { alt as altMap } from '../assets/alt';

// Intrinsic aspect ratios (width / height) of the curated WebP set. Everything else is square.
const WIDE: ReadonlySet<string> = new Set([
  'blob.parent', 'blob.admin', 'blob.caregiver',
  'brand.cover', 'brand.featureGraphic', 'brand.wordmark',
  'moment.avatarApproved', 'onboarding.hero',
  'video.title', 'video.end', 'video.chapterParent', 'video.chapterDaycare', 'video.chapterCall',
]);

export function aspectOf(asset: AssetKey): number {
  if (asset === 'brand.splash') return 1024 / 1792;
  return WIDE.has(asset) ? 1400 / 800 : 1;
}

export interface IllustrationProps {
  asset: AssetKey;
  /** Rendered width in CSS px (height follows the asset's aspect ratio). */
  size: number;
  /** Above-the-fold images: load eagerly instead of lazily. */
  priority?: boolean;
  /** Overrides the alt text from the per-key alt map. */
  alt?: string;
  className?: string;
  /**
   * Fill the parent box (width and height 100%) instead of a fixed size; `size` then only picks the intrinsic
   * width/height attributes. The caller decides the fit with a class or its own CSS (the Welcome hero, task 26c).
   */
  fill?: boolean;
}

export function Illustration({ asset, size, priority, alt, className, fill }: IllustrationProps) {
  const text = alt ?? altMap[asset];
  const decorative = text === '';
  const width = Math.round(size);
  const height = Math.round(size / aspectOf(asset));
  return (
    <img
      src={img[asset]}
      srcSet={imgSrcSet(asset)}
      width={width}
      height={height}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      alt={text}
      aria-hidden={decorative ? true : undefined}
      draggable={false}
      className={clsx('select-none object-contain', className)}
      style={fill ? { width: '100%', height: '100%' } : { width, height }}
    />
  );
}
