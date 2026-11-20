import clsx from 'clsx';
import type { TranscriptLine } from '../../lib/queries';
import { clockLabel } from './sessionCopy';

/**
 * The lines a parent sees: only what the child and the avatar said (system lines are internal), and never a turn
 * with no words (an empty "Mia said" bubble, device test P-5).
 */
export const shownLines = (lines: TranscriptLine[]): TranscriptLine[] =>
  lines.filter((l) => (l.role === 'User' || l.role === 'Assistant') && typeof l.text === 'string' && l.text.trim() !== '');

/** The conversation as chat bubbles: the avatar on the left, the child on the right, each with its time (epoch ms). */
export function Transcript({ lines, childName, avatarName = 'Your avatar' }: { lines: TranscriptLine[]; childName: string; avatarName?: string }) {
  return (
    <ol className="flex flex-col gap-2.5" aria-label="Conversation">
      {shownLines(lines).map((l, i) => {
        const kid = l.role === 'User';
        return (
          <li key={i} data-side={kid ? 'right' : 'left'} className={clsx('flex flex-col', kid ? 'items-end' : 'items-start')}>
            <p
              className={clsx(
                'max-w-[82%] whitespace-pre-wrap break-words rounded-[20px] px-3.5 py-2 text-[15px] leading-snug',
                kid ? 'rounded-br-md bg-sun text-ink' : 'rounded-bl-md border-card border-line bg-white text-ink',
              )}
            >
              <span className="sr-only">{kid ? `${childName} said: ` : `${avatarName} said: `}</span>
              {l.text}
            </p>
            {typeof l.timestamp === 'number' && Number.isFinite(l.timestamp) ? (
              <span className="mt-0.5 px-1 text-[11px] text-mutedText">{clockLabel(l.timestamp)}</span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
