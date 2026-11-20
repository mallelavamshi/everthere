import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion as fm } from 'framer-motion';
import clsx from 'clsx';
import type { Caption } from '../sessionMachine';

/** One line of words: blank lines and whitespace runs (a sung lyric's line breaks) collapse to single spaces (26c). */
export const captionText = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Long lines keep their newest words (a cheap upper bound before the line clamp). */
export function captionTail(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(text.length - max);
  const sp = cut.indexOf(' ');
  return `…${sp > 0 && sp < 24 ? cut.slice(sp + 1) : cut}`;
}

const LINE = 1.375; // leading-snug
const FADE: CSSProperties = {
  maskImage: 'linear-gradient(to bottom, transparent 0, black 1.1em)',
  WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, black 1.1em)',
};

/**
 * At most `lines` lines, bottom-anchored so the newest (streaming) words stay visible; older words overflow off the
 * top and fade out. Keeps a long avatar line from growing over the avatar's face.
 */
function ClampedText({ text, lines }: { text: string; lines: number }) {
  const outer = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (o && i) setClamped(i.offsetHeight > o.clientHeight + 1);
  }, [text, lines]);
  return (
    <span ref={outer} className="flex flex-col justify-end overflow-hidden" style={{ maxHeight: `${lines * LINE}em`, ...(clamped ? FADE : null) }}>
      <span ref={inner} className="block">
        {text}
      </span>
    </span>
  );
}

/**
 * The last two caption bubbles: the avatar on the left in large text, the child on the right, smaller and muted.
 * Not a live region itself (it streams word by word); LiveSession announces completed lines separately.
 * A line with no words (empty or whitespace-only) never gets a bubble (device test P-5).
 */
export function Captions({ captions }: { captions: Caption[] }) {
  return (
    <div className="flex w-full flex-col gap-2">
      <AnimatePresence initial={false} mode="popLayout">
        {captions.filter((c) => c.text.trim()).map((c) => (
          <fm.div
            key={c.id}
            data-testid="caption"
            layout="position"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className={clsx(
              'max-w-[86%] whitespace-pre-wrap break-words border-ink leading-snug',
              c.role === 'avatar'
                ? 'self-start rounded-[20px] rounded-bl-md border-[2.5px] bg-white px-4 py-2.5 text-[21px] font-medium text-ink landscape:text-[20px] portrait:sm:text-[24px]'
                : 'self-end rounded-[18px] rounded-br-md border-2 bg-sky px-3.5 py-2 text-[15px] text-mutedText',
            )}
          >
            <ClampedText text={captionTail(captionText(c.text), c.role === 'avatar' ? 150 : 90)} lines={c.role === 'avatar' ? 3 : 2} />
          </fm.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
