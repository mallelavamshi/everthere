import type { SessionItem } from '@everthere/shared';
import { Card } from '../../ui';
import { clockLabel, lengthLabel, moodPill, reasonLabel, sessionTitle, sessionTone, summaryPending } from './sessionCopy';

/** The "Writing your summary…" line: a soft shimmer while the summary is still being made. */
export function PendingSummary() {
  return (
    <p className="et-skeleton mt-2 inline-block rounded-full px-3 py-1 text-[14px] font-medium text-mutedText">Writing your summary…</p>
  );
}

/** One comfort call as a card (mockup 4's header): how it ended, mood change, the facts, and the summary. */
export function SessionCard({ s, onClick, now }: { s: SessionItem; onClick?: () => void; now?: number }) {
  const name = s.child?.name || 'Your little one';
  // The parent whose avatar was in this call (Daddy's call says Daddy, whoever is looking).
  const parentTitle = s.parentTitle || 'Mom';
  const pill = moodPill(s, parentTitle);
  const meta = [clockLabel(s.startedAt), lengthLabel(s.durationS), reasonLabel(s.reason, parentTitle), s.caregiverName ? `with ${s.caregiverName}` : null]
    .filter(Boolean)
    .join(' · ');
  const tone = sessionTone(s);
  return (
    <Card tone={tone} onClick={onClick}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[18px] font-semibold leading-tight">{sessionTitle(s, name)}</h3>
        {pill ? (
          <span role="img" aria-label={pill.label} className="shrink-0 rounded-full bg-white px-3 py-1 text-[15px] leading-snug">
            {pill.text}
          </span>
        ) : null}
      </div>
      <p className={tone === 'mint' ? 'mt-1 text-[13px] text-mintInk' : 'mt-1 text-[13px] text-mutedText'}>{meta}</p>
      {s.summary ? (
        <p className="mt-2 line-clamp-2 text-[15px] leading-snug">{s.summary}</p>
      ) : summaryPending(s, now) ? (
        <PendingSummary />
      ) : (
        <p className="mt-2 text-[14px] text-mutedText">No summary for this call</p>
      )}
      {s.flags.length ? (
        <p className="mt-2 text-[13px] font-semibold text-danger">
          <span aria-hidden="true">⚑ </span>
          {s.flags.length === 1 ? 'A moment worth a look' : `${s.flags.length} moments worth a look`}
        </p>
      ) : null}
    </Card>
  );
}
