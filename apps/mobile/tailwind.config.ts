import type { Config } from 'tailwindcss';
import { colors, fonts, radii, shadows } from './src/theme/tokens';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors,
      fontFamily: { sans: [fonts.sans] },
      borderRadius: { card: radii.card, btn: radii.btn, seg: radii.seg, sheet: radii.sheet },
      borderWidth: { btn: '2.5px' },
      boxShadow: { chunky: shadows.chunky, mint: shadows.mint, sky: shadows.sky, sun: shadows.sun, focus: shadows.focus, sheet: shadows.sheet, toast: shadows.toast },
      minHeight: { touch: '44px' },
      minWidth: { touch: '44px' },
    },
  },
  plugins: [],
} satisfies Config;
