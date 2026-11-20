const normQuote = (s: string | null): string =>
  (s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** True when the quote has at least one word once case and punctuation are stripped. */
export const hasWords = (s: string | null): boolean => normQuote(s).length > 0;

/**
 * Two quotes describe the same words: case and punctuation ignored, one contains the other (whole words), or they
 * share at least 60% of the smaller quote's distinct words. An empty quote overlaps anything.
 */
export function quotesOverlap(a: string | null, b: string | null): boolean {
  const x = normQuote(a);
  const y = normQuote(b);
  if (!x || !y) return true;
  if (` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `)) return true;
  const wx = new Set(x.split(' '));
  const wy = new Set(y.split(' '));
  let shared = 0;
  for (const w of wx) if (wy.has(w)) shared++;
  return shared / Math.min(wx.size, wy.size) >= 0.6;
}
