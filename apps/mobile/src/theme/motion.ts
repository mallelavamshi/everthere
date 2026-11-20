import type { Transition, Variants } from 'framer-motion';
import { colors, shadows } from './tokens';

// Motion presets. Components run inside <MotionRoot/> (MotionConfig reducedMotion="user"), so transform
// animations are skipped automatically when the OS asks for reduced motion.

export const motion = {
  /** Chunky button / card press. */
  press: { type: 'spring', stiffness: 700, damping: 32, mass: 0.6 } as Transition,
  /** Pressed visual state shared by Button and tappable Card. */
  pressed: { y: 3, boxShadow: shadows.chunkyPressed },
  /** Playful pop-in for badges, toasts, selected states. */
  pop: {
    initial: { opacity: 0, scale: 0.85 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.9 },
    transition: { type: 'spring', stiffness: 420, damping: 22 } as Transition,
  },
  /** A screen (or a step inside a flow) arriving: a short slide from the right with a fade. */
  page: {
    initial: { opacity: 0, x: 28 },
    animate: { opacity: 1, x: 0 },
    transition: { type: 'spring', stiffness: 420, damping: 38 } as Transition,
  },
  /** Bottom sheets sliding in. */
  slideUp: {
    initial: { y: '100%' },
    animate: { y: 0 },
    exit: { y: '100%' },
    transition: { type: 'spring', stiffness: 380, damping: 36 } as Transition,
  },
  /** Parent + children for lists that fade/slide in one after another. */
  stagger: {
    container: { hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } } } as Variants,
    item: {
      hidden: { opacity: 0, y: 12 },
      show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 380, damping: 28 } },
    } as Variants,
  },
  /** Burst config for celebration moments (consumed by a confetti component later). */
  confetti: {
    count: 24,
    colors: [colors.sun, colors.coral, colors.mint, colors.sky, colors.lilac],
    duration: 1.1,
    spread: 140,
    transition: { type: 'spring', stiffness: 90, damping: 14 } as Transition,
  },
} as const;
