import { motion as fm } from 'framer-motion';
import { motion } from '../../theme/motion';

const { count, colors, duration, spread } = motion.confetti;

/** A one-shot burst from the centre. Deterministic (no Math.random) so renders are stable; reduced motion skips it. */
export function Confetti() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <div className="absolute left-1/2 top-[34%]">
        {Array.from({ length: count }, (_, i) => {
          const angle = (i / count) * Math.PI * 2 + (i % 2) * 0.2;
          const dist = spread + (i % 3) * 36;
          return (
            <fm.span
              key={i}
              className="absolute block h-3 w-2 rounded-sm"
              style={{ backgroundColor: colors[i % colors.length], rotate: i * 37 }}
              initial={{ x: 0, y: 0, opacity: 1, scale: 0.4 }}
              animate={{ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist + 70, opacity: 0, scale: 1, rotate: i * 37 + 240 }}
              transition={{ duration: duration * 1.4, ease: 'easeOut' }}
            />
          );
        })}
      </div>
    </div>
  );
}
