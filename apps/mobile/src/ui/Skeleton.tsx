import clsx from 'clsx';

export type SkeletonShape = 'line' | 'circle' | 'card' | 'chip' | 'block';

export interface SkeletonProps {
  shape?: SkeletonShape;
  width?: number | string;
  height?: number | string;
  /** Number of repeated skeletons (e.g. lines in a paragraph). */
  count?: number;
  className?: string;
}

const shapes: Record<SkeletonShape, string> = {
  line: 'h-4 w-full rounded-full',
  circle: 'h-12 w-12 rounded-full',
  card: 'h-24 w-full rounded-card border-2 border-line',
  chip: 'h-8 w-24 rounded-full',
  block: 'h-32 w-full rounded-card',
};

/** Decorative shimmer placeholder. Announces itself to assistive tech via aria-busy and an sr-only "Loading" label. */
export function Skeleton({ shape = 'line', width, height, count = 1, className }: SkeletonProps) {
  return (
    <div aria-busy="true">
      <span className="sr-only">Loading</span>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          data-skeleton={shape}
          style={{ width, height, display: 'block' }}
          className={clsx('et-skeleton', shapes[shape], count > 1 && i > 0 && 'mt-2.5', className)}
        />
      ))}
    </div>
  );
}
