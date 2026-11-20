import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { FlagCategory, SessionFlagView } from '@everthere/shared';
import { ApiError, friendlyMessage } from '../../lib/api';
import { useSession, type SessionDetailView } from '../../lib/queries';
import { Badge, Card, ErrorState, Illustration, Skeleton } from '../../ui';
import { ParentScreen } from '../parent/ParentScreen';
import { PendingSummary } from './SessionCard';
import { shownLines, Transcript } from './Transcript';
import { clockLabel, lengthLabel, moodPill, reasonLabel, REASON_STICKER, sessionTitle, sessionTone, summaryPending, whenLabel } from './sessionCopy';

const CATEGORY: Record<FlagCategory, string> = {
  injury: 'A bump or boo-boo',
  illness: 'Not feeling well',
  hurt_by_someone: 'Someone may have hurt them',
  scared_of_person: 'Scared of someone',
  unsafe: 'Something felt unsafe',
  other: 'Something worth a look',
};

/** Who the quote is from: a manual flag is the caregiver's own note, live/post flags quote the child. */
export function flagQuoteLead(source: SessionFlagView['source'], childName: string, caregiverName: string): string {
  return source === 'manual' ? `${caregiverName || 'Your caregiver'} noted` : `${childName} said`;
}

function FlagCard({ flag, childName, caregiverName }: { flag: SessionFlagView; childName: string; caregiverName: string }) {
  return (
    <Card tone="flag" data-testid="flag-card">
      <p className="text-[15px] font-semibold text-danger">
        <span aria-hidden="true">⚑ </span>Heads up: {CATEGORY[flag.category as FlagCategory] ?? CATEGORY.other}
      </p>
      {flag.quote ? (
        <p className="mt-1.5 text-[16px] leading-snug">
          {flagQuoteLead(flag.source, childName, caregiverName)}: <span className="font-medium">&ldquo;{flag.quote}&rdquo;</span>
        </p>
      ) : null}
    </Card>
  );
}

function Body({ s }: { s: SessionDetailView }) {
  const name = s.child?.name || 'Your little one';
  // The parent whose avatar was in this call, not the viewer's own avatar.
  const parentTitle = s.parentTitle || undefined;
  const pill = moodPill(s, parentTitle);
  const tone = sessionTone(s);
  const reason = reasonLabel(s.reason, parentTitle);
  const hasAccess = 'transcript' in s;
  const lines = shownLines(s.transcript ?? []);
  const transcriptShown = lines.length > 0;

  return (
    <div className="flex flex-col gap-3 pt-1">
      {s.flags.map((f) => (
        <FlagCard key={f.id} flag={f} childName={name} caregiverName={s.caregiverName} />
      ))}

      <Card tone={tone}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[20px] font-semibold leading-tight">{sessionTitle(s, name)}</h2>
          {pill ? (
            <span role="img" aria-label={pill.label} className="shrink-0 rounded-full bg-white px-3 py-1 text-[16px] leading-snug">
              {pill.text}
            </span>
          ) : null}
        </div>
        {s.caregiverNote ? (
          <div className="mt-3 rounded-2xl bg-white/70 px-3 py-2">
            <p className="text-[12px] font-semibold uppercase tracking-[0.05em] text-mutedText">Note from {s.caregiverName || 'the caregiver'}</p>
            <p className="mt-0.5 text-[15px] leading-snug">{s.caregiverNote}</p>
          </div>
        ) : null}
        {s.summary ? (
          <p className="mt-3 text-[16px] leading-snug">{s.summary}</p>
        ) : summaryPending(s) ? (
          <PendingSummary />
        ) : (
          <div className="mt-3">
            <p className="text-[16px] font-semibold">No summary for this call</p>
            <p className="mt-0.5 text-[14px] leading-snug text-mutedText">
              Sometimes a call is too short to sum up.
              {transcriptShown ? ' The conversation is still below.' : ''}
            </p>
          </div>
        )}
      </Card>

      <div data-testid="facts" className="flex flex-wrap gap-2">
        {reason && s.reason ? (
          <Badge tone="sun" icon={<Illustration asset={REASON_STICKER[s.reason]} size={18} alt="" />}>
            {reason}
          </Badge>
        ) : null}
        {lengthLabel(s.durationS) ? <Badge tone="neutral">{lengthLabel(s.durationS)}</Badge> : null}
        {s.caregiverName ? <Badge tone="sky">with {s.caregiverName}</Badge> : null}
        <Badge tone="neutral">{clockLabel(s.startedAt)}</Badge>
      </div>

      {hasAccess ? (
        transcriptShown ? (
          <section className="flex flex-col gap-2.5 pt-1">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-mutedText">Conversation</h2>
            <Transcript lines={lines} childName={name} avatarName={parentTitle ? `${parentTitle}'s avatar` : 'Your avatar'} />
          </section>
        ) : (
          <Card tone="white" lift={false}>
            <p className="text-[15px] text-mutedText">No conversation was saved for this call.</p>
          </Card>
        )
      ) : (
        <Card tone="sky">
          <p className="text-[16px] font-semibold">Full conversation is private to {name}&apos;s parents</p>
          <p className="mt-1 text-[14px] leading-snug">You can still see how the call went above. The words themselves stay with the family.</p>
        </Card>
      )}
    </div>
  );
}

/** One comfort call: what's worth a look first, then how it ended, the facts, and the conversation. */
export function SessionDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const session = useSession(id);
  const s = session.data;

  // Opened from a notification there is nothing to go back to: land on the feed.
  const back = () => (location.key === 'default' ? navigate('/parent/sessions', { replace: true }) : navigate(-1));

  return (
    <ParentScreen tab="sessions" title={s ? whenLabel(s.startedAt) : 'Comfort call'} back={back} actions={null}>
      {session.isPending ? (
        <div className="flex flex-col gap-3 pt-1">
          <Skeleton shape="card" height={110} />
          <Skeleton shape="card" height={140} />
        </div>
      ) : session.isError || !s ? (
        <ErrorState
          offline={session.error instanceof ApiError && session.error.code === 'NETWORK'}
          body={session.error instanceof ApiError ? friendlyMessage(session.error.code) : undefined}
          onRetry={() => void session.refetch()}
          retrying={session.isFetching}
        />
      ) : (
        <Body s={s} />
      )}
    </ParentScreen>
  );
}

export default SessionDetail;
