// Single source of truth for the "Sunny & Playful" design tokens.
// tailwind.config.ts consumes them, and global.css reads them back through Tailwind's theme() function,
// so no palette hex lives anywhere else (a test enforces this for src/ui, motion.ts and global.css).

export const colors = {
  ink: '#2B2140',
  /** Decorative muted (borders, dashed chips). Too light for body text on cream (4.49:1). */
  muted: '#7A6E8A',
  /** Muted text that meets WCAG AA on cream (5.6:1). Use this for secondary copy. */
  mutedText: '#6B5F7B',
  cream: '#FFF8EC',
  white: '#FFFFFF',
  sun: '#FFD23F',
  sunD: '#E8B400',
  coral: '#FF7A59',
  coralD: '#E0583A',
  mint: '#C9F2E1',
  mintD: '#8FDDBE',
  /** Readable green for text on cream/white/mint. */
  mintInk: '#2F6B55',
  sky: '#CFE6FF',
  skyD: '#9CC8F5',
  lilac: '#E7DEFF',
  line: '#F1E6D2',
  flag: '#FFE3D6',
  /** Error text on cream (5.5:1); coralD is only for fills and borders. */
  danger: '#B8391C',
  track: '#EADFCB',
  /** Warm start colour of the soft top of the welcome gradient. */
  sunSoft: '#FFE79A',
  /** Skeleton shimmer stops. */
  skeletonA: '#F3E9D6',
  skeletonB: '#FFF6E4',
  /** Live-session sunset (mockup 7): warm centre, peach, lilac-dusk edge. */
  sunsetGlow: '#FFE7B0',
  sunsetPeach: '#F6B98E',
  sunsetDusk: '#8E6CC0',
  /** The LIVE chip's recording dot. */
  liveDot: '#E0383A',
} as const;

export const gradients = {
  sunGradient: `linear-gradient(180deg, ${colors.sunSoft} 0%, ${colors.cream} 55%)`,
  /** Soft ink scrim under captions that sit inside the avatar frame (landscape). */
  captionScrim: 'linear-gradient(180deg, rgba(43, 33, 64, 0) 0%, rgba(43, 33, 64, 0.38) 45%, rgba(43, 33, 64, 0.55) 100%)',
  /** Full-bleed live-session background. */
  sunset: `radial-gradient(circle at 50% 38%, ${colors.sunsetGlow} 0%, ${colors.sunsetPeach} 38%, ${colors.sunsetDusk} 100%)`,
  skeleton: `linear-gradient(90deg, ${colors.skeletonA} 0%, ${colors.skeletonB} 45%, ${colors.skeletonA} 90%)`,
} as const;

export const radii = { card: '20px', btn: '20px', seg: '16px', sheet: '28px', pill: '999px' } as const;

export const borders = { btn: '2.5px', card: '2px' } as const;

export const shadows = {
  chunky: `0 4px 0 ${colors.ink}`,
  chunkyPressed: `0 1px 0 ${colors.ink}`,
  mint: `0 4px 0 ${colors.mintD}`,
  sky: `0 4px 0 ${colors.skyD}`,
  sun: `0 4px 0 ${colors.sunD}`,
  /** Sun halo for focused fields and ringed avatars. */
  focus: `0 0 0 3px ${colors.sun}`,
  sheet: '0 -8px 32px rgba(43, 33, 64, 0.18)',
  toast: `0 4px 0 ${colors.ink}, 0 10px 24px rgba(43, 33, 64, 0.2)`,
} as const;

export const fonts = {
  sans: "'Fredoka', system-ui, sans-serif",
} as const;

/** Minimum touch target in CSS px. */
export const MIN_TOUCH = 44;

export const backdrop = 'rgba(43, 33, 64, 0.55)';

/** WCAG relative-luminance contrast ratio between two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
