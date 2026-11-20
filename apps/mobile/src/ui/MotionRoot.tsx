import { MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';

/** Mount once at the app root: every Framer Motion animation then honours prefers-reduced-motion. */
export function MotionRoot({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
