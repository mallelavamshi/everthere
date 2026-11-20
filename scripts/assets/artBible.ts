// Art bible: spec 7a. One shared style prompt so every asset looks like one family.
export const PALETTE = {
  sun: '#FFD23F',
  coral: '#FF7A59',
  mint: '#C9F2E1',
  lilac: '#E7DEFF',
  sky: '#CFE6FF',
  ink: '#2B2140',
  cream: '#FFF8EC',
} as const;

export const ART_BIBLE =
  'Warm, joyful 3D clay-toy illustration, soft studio lighting, rounded chunky forms, gentle subsurface glow. ' +
  `Palette locked to: sun ${PALETTE.sun}, coral ${PALETTE.coral}, mint ${PALETTE.mint}, lilac ${PALETTE.lilac}, sky ${PALETTE.sky}, ink ${PALETTE.ink}, on cream ${PALETTE.cream} or a transparent background. ` +
  'No text or lettering unless stated. ';

export const BG_CREAM = `On a flat solid cream ${PALETTE.cream} background.`;
export const BG_CLEAN = `On a flat solid cream ${PALETTE.cream} background with generous clear space around a single centered subject, no shadow on the ground, so the subject can be cut out cleanly.`;
