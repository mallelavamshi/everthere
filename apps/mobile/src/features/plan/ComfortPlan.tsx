import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import type { PlanView, Tone } from '@everthere/shared';
import { ApiError, friendlyMessage } from '../../lib/api';
import { haptics } from '../../lib/native';
import { qk, useAvatar, useChildren, usePlan } from '../../lib/queries';
import { Button, EmptyState, ErrorState, Field, Illustration, Screen, Segmented, Sheet, sheetStack, Skeleton, toast } from '../../ui';
import { ChipInput, type ChipSuggestion } from './ChipInput';
import { LockedRules } from './LockedRules';
import { LIMITS, putPlan, type PlanInput } from './planApi';

const TITLES = ['Mommy', 'Mama', 'Mom', 'Daddy', 'Dada', 'Papa'] as const;
const TONES: { value: Tone; label: string; icon: string }[] = [
  { value: 'calm', label: 'Calm', icon: '😌' },
  { value: 'playful', label: 'Playful', icon: '🎈' },
  { value: 'soothing', label: 'Soothing', icon: '🌙' },
];
const sticker = (asset: 'sticker.bunny' | 'sticker.dino' | 'sticker.heart') => <Illustration asset={asset} size={22} alt="" />;
const FAVORITES: ChipSuggestion[] = [
  { label: 'Bunny', icon: sticker('sticker.bunny') },
  { label: 'Dinos', icon: sticker('sticker.dino') },
  { label: 'Trucks', icon: '🚚' },
  { label: 'Princesses', icon: '👑' },
  { label: 'Bubbles', icon: '🫧' },
];
const PHRASES: ChipSuggestion[] = [
  { label: "I'm here with you" },
  { label: "You're safe" },
  { label: 'Deep breaths' },
  { label: 'I love you', icon: sticker('sticker.heart') },
];
const NICKNAMES: ChipSuggestion[] = [
  { label: 'Sweetie', icon: '🍯' },
  { label: 'Sunshine', icon: '☀️' },
  { label: 'Buddy' },
];

// ---- draft -----------------------------------------------------------------------------------------------------

interface Draft {
  parentTitle: string;
  tone: Tone;
  nicknames: string[];
  favorites: string[];
  phrases: string[];
  songTitle: string;
  songLyrics: string;
  neverTopics: string[];
}

const fromPlan = (p: PlanView): Draft => ({
  parentTitle: p.parentTitle,
  tone: p.tone,
  nicknames: p.nicknames,
  favorites: p.favorites,
  phrases: p.phrases,
  songTitle: p.songTitle ?? '',
  songLyrics: p.songLyrics ?? '',
  neverTopics: p.neverTopics,
});

const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

type Errors = Partial<Record<keyof Draft, string>>;

function validate(d: Draft, childName: string): Errors {
  const e: Errors = {};
  const title = d.parentTitle.trim();
  if (!title) e.parentTitle = `Pick or type what ${childName} calls you.`;
  else if (title.length > LIMITS.parentTitle) e.parentTitle = `Keep it to ${LIMITS.parentTitle} characters.`;
  if (d.songTitle.length > LIMITS.songTitle) e.songTitle = `The title can be up to ${LIMITS.songTitle} characters.`;
  if (d.songLyrics.length > LIMITS.lyrics) e.songLyrics = `Lyrics can be up to ${LIMITS.lyrics} characters (yours has ${d.songLyrics.length}).`;
  for (const k of ['nicknames', 'favorites', 'phrases', 'neverTopics'] as const) {
    if (d[k].length > LIMITS.list || d[k].some((v) => v.length > LIMITS.item)) e[k] = `Up to ${LIMITS.list} chips, ${LIMITS.item} characters each.`;
  }
  return e;
}

const toBody = (d: Draft, todayNote: string | null | undefined): PlanInput => ({
  parentTitle: d.parentTitle.trim(),
  tone: d.tone,
  nicknames: d.nicknames,
  favorites: d.favorites,
  phrases: d.phrases,
  songTitle: d.songTitle.trim() || undefined,
  songLyrics: d.songLyrics.trim() || undefined,
  neverTopics: d.neverTopics,
  // The PUT replaces everything, so keep today's note as it is.
  todayNote: todayNote ?? undefined,
});

// ---- small pieces ----------------------------------------------------------------------------------------------

const labelCls = 'text-[13px] font-semibold uppercase tracking-[0.06em] text-mutedText';

const radioChip = (on: boolean) =>
  clsx(
    'inline-flex min-h-[44px] items-center rounded-full border-2 px-4 text-[15px] font-medium transition-colors',
    on ? 'border-ink bg-sun' : 'border-ink bg-white active:bg-cream',
  );

/** "Mia calls me": exactly one choice, from the usual names or your own. */
function TitlePicker({ childName, value, onChange, error }: { childName: string; value: string; onChange: (v: string) => void; error?: string }) {
  const uid = useId();
  const [custom, setCustom] = useState<string | null>(() => (TITLES.some((t) => t === value) || !value ? null : value));
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const options: string[] = [...TITLES, ...(custom ? [custom] : [])];

  const commit = () => {
    const v = text.trim().slice(0, LIMITS.parentTitle);
    setAdding(false);
    setText('');
    if (!v) return;
    const known = options.find((o) => o.toLowerCase() === v.toLowerCase());
    if (!known) setCustom(v);
    onChange(known ?? v);
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = options[(i + dir + options.length) % options.length]!;
    onChange(next);
    (e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]')[(i + dir + options.length) % options.length])?.focus();
  };

  const stop = options.includes(value) ? value : options[0];
  return (
    <div className="flex flex-col gap-2">
      <span id={`${uid}-l`} className={labelCls}>
        {childName} calls me
      </span>
      <div role="radiogroup" aria-labelledby={`${uid}-l`} className="flex flex-wrap gap-2">
        {options.map((o, i) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={o === value}
            tabIndex={o === stop ? 0 : -1}
            onClick={() => onChange(o)}
            onKeyDown={(e) => onKey(e, i)}
            className={radioChip(o === value)}
          >
            {o}
          </button>
        ))}
        {adding ? (
          <input
            autoFocus
            type="text"
            aria-label={`What does ${childName} call you?`}
            value={text}
            maxLength={LIMITS.parentTitle}
            placeholder="Type a name"
            enterKeyHint="done"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.stopPropagation();
                setAdding(false);
                setText('');
              }
            }}
            onBlur={commit}
            className="min-h-[44px] w-40 rounded-full border-2 border-ink/80 bg-white px-4 text-[15px] focus:border-ink focus:outline-none focus:shadow-focus"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex min-h-[44px] items-center rounded-full border-2 border-dashed border-muted px-4 text-[15px] font-medium text-mutedText"
          >
            ＋ Add your own
          </button>
        )}
      </div>
      {error ? (
        <p role="alert" className="flex items-start gap-1 text-[13px] font-medium text-danger">
          <span aria-hidden="true">⚠️</span>
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

const grow = (el: HTMLTextAreaElement | null) => {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight + 2, 360)}px`;
};

// ---- the form --------------------------------------------------------------------------------------------------

function PlanForm({ plan, childId, avatarId, childName, canTest, goBack }: { plan: PlanView; childId: string; avatarId: string; childName: string; canTest: boolean; goBack: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [base, setBase] = useState(() => fromPlan(plan));
  const [draft, setDraft] = useState(base);
  const [showErrors, setShowErrors] = useState(false);
  const [leaveTo, setLeaveTo] = useState<(() => void) | null>(null);
  const lyricsId = useId();

  const dirty = !same(draft, base);
  const errors = validate(draft, childName);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = useMutation({
    mutationFn: (sent: Draft) => {
      // Today's note may have changed from the Home card since this screen loaded: read the latest copy.
      const live = qc.getQueryData<PlanView>(qk.plan(childId, avatarId)) ?? plan;
      return putPlan(childId, avatarId, toBody(sent, live.todayNote));
    },
    onSuccess: (res, sent) => {
      qc.setQueryData(qk.plan(childId, avatarId), res);
      const saved = fromPlan(res);
      setBase(saved);
      // Edits made while the save was in flight stay (and keep the form dirty); otherwise take the server's copy.
      setDraft((d) => (same(d, sent) ? saved : d));
      setShowErrors(false);
      haptics.success();
      toast.success(`Saved — ${res.parentTitle}'s avatar will remember 💛`);
    },
    onError: (e) => {
      haptics.error();
      toast.error(e instanceof ApiError ? friendlyMessage(e.code) : friendlyMessage('INTERNAL'));
    },
  });

  const submit = () => {
    if (!dirty || save.isPending) return;
    if (Object.keys(errors).length) {
      setShowErrors(true);
      haptics.error();
      return;
    }
    save.mutate(draft);
  };

  // Leaving (back arrow, Android back, or the test call) with edits asks first.
  const goBackRef = useRef(goBack);
  goBackRef.current = goBack;
  const requestLeave = (go: () => void) => (dirty ? setLeaveTo(() => go) : go());
  useEffect(() => {
    if (!dirty) return;
    // Not a visible sheet, so it does not lock the page: Android back just asks the question.
    const { unregister } = sheetStack.register(() => setLeaveTo(() => () => goBackRef.current()), { lock: false });
    return unregister;
  }, [dirty]);

  // The lyrics box grows with what is typed.
  useLayoutEffect(() => grow(document.getElementById(lyricsId) as HTMLTextAreaElement | null), [draft.songLyrics, lyricsId]);

  const err = (k: keyof Draft) => (showErrors ? errors[k] : undefined);
  const lyricsLen = draft.songLyrics.length;

  return (
    <Screen
      title={`${childName}'s comfort plan`}
      back={() => requestLeave(goBack)}
      footer={
        <div className="flex gap-2">
          <Button size="lg" className="shrink-0 !px-5" loading={save.isPending} disabled={!dirty} onClick={submit}>
            Save
          </Button>
          {canTest ? (
            <Button variant="coral" size="lg" fullWidth className="!px-3" icon="🎥" onClick={() => requestLeave(() => navigate(`/parent/avatar/test/${avatarId}`))}>
              Try a test call
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-5 pb-2">
        <header>
          <h2 className="text-[22px] font-semibold leading-tight">How do you comfort {childName}?</h2>
          <p className="mt-0.5 text-[14px] text-mutedText">Tap or type. Your avatar learns your little ways.</p>
        </header>

        <TitlePicker childName={childName} value={draft.parentTitle} onChange={(v) => set('parentTitle', v)} error={err('parentTitle')} />

        <ChipInput label={`I call ${childName}`} values={draft.nicknames} onChange={(v) => set('nicknames', v)} suggestions={NICKNAMES} placeholder="Sunshine, Mia-bear…" error={err('nicknames')} />

        <div className="flex flex-col gap-2">
          <span id="tone-l" className={labelCls}>
            Tone
          </span>
          <Segmented
            aria-label="Tone"
            options={TONES.map((t) => ({ value: t.value, label: t.label, icon: t.icon }))}
            value={draft.tone}
            onChange={(v) => set('tone', v)}
          />
        </div>

        <ChipInput label="Favorite things" values={draft.favorites} onChange={(v) => set('favorites', v)} suggestions={FAVORITES} placeholder="Bunnies, trains…" error={err('favorites')} />

        <ChipInput label="Comfort phrases" values={draft.phrases} onChange={(v) => set('phrases', v)} suggestions={PHRASES} placeholder="Words you always say" error={err('phrases')} />

        <section aria-labelledby="song-l" className="flex flex-col gap-3">
          <span id="song-l" className={labelCls}>
            Our song
          </span>
          <Field label="Song title" value={draft.songTitle} maxLength={LIMITS.songTitle} placeholder="Twinkle Twinkle Little Star" error={err('songTitle')} onChange={(e) => set('songTitle', e.target.value)} />
          <Field
            multiline
            id={lyricsId}
            label="Lyrics (optional)"
            value={draft.songLyrics}
            maxLength={LIMITS.lyrics}
            rows={3}
            placeholder="A few lines your little one loves"
            hint={lyricsLen >= LIMITS.lyrics - 200 ? `${lyricsLen} / ${LIMITS.lyrics}` : undefined}
            error={err('songLyrics')}
            style={{ resize: 'none', overflowY: 'auto' }}
            onChange={(e) => {
              set('songLyrics', e.target.value);
              grow(e.currentTarget);
            }}
          />
        </section>

        <ChipInput label="Never talk about" tone="coral" values={draft.neverTopics} onChange={(v) => set('neverTopics', v)} placeholder="Something tender or scary" error={err('neverTopics')} />

        <LockedRules />
      </div>

      <Sheet
        open={leaveTo !== null}
        onClose={() => setLeaveTo(null)}
        title="Leave without saving?"
        footer={
          <div className="flex flex-col gap-2">
            <Button size="lg" fullWidth onClick={() => setLeaveTo(null)}>
              Keep editing
            </Button>
            <Button
              variant="ghost"
              fullWidth
              onClick={() => {
                const go = leaveTo;
                setLeaveTo(null);
                go?.();
              }}
            >
              Leave
            </Button>
          </div>
        }
      >
        <p className="pb-2 text-[16px] leading-relaxed">Your changes to {childName}'s comfort plan haven't been saved yet.</p>
      </Sheet>
    </Screen>
  );
}

// ---- the route -------------------------------------------------------------------------------------------------

/** /parent/children/:childId/plan/:avatarId — mockup 3. */
export function ComfortPlan() {
  const { childId = '', avatarId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const plan = usePlan(childId, avatarId);
  const children = useChildren();
  const avatars = useAvatar();

  const goBack = () => (location.key === 'default' ? navigate('/parent', { replace: true }) : navigate(-1));
  const childName = children.data?.find((c) => c.id === childId)?.name ?? 'your little one';

  if (plan.isError) {
    const err = plan.error;
    if (err instanceof ApiError && err.code === 'NOT_FOUND') {
      return (
        <Screen back={goBack}>
          <EmptyState
            asset="empty.error"
            title="We couldn't find that plan"
            body="It may have moved on, or it belongs to someone else's avatar. Let's head back."
            action={{ label: 'Back to home', onClick: () => navigate('/parent', { replace: true }) }}
          />
        </Screen>
      );
    }
    return (
      <Screen back={goBack}>
        <ErrorState offline={err instanceof ApiError && err.code === 'NETWORK'} body={err instanceof ApiError ? friendlyMessage(err.code) : undefined} onRetry={() => void plan.refetch()} retrying={plan.isFetching} />
      </Screen>
    );
  }
  if (plan.isPending || children.isPending) {
    return (
      <Screen title="Comfort plan" back={goBack}>
        <div className="flex flex-col gap-4 pt-2">
          <Skeleton shape="line" width={240} height={28} />
          <Skeleton shape="chip" count={3} />
          <Skeleton shape="card" />
          <Skeleton shape="card" />
        </div>
      </Screen>
    );
  }

  const canTest = !!avatars.data?.some((a) => a.id === avatarId);
  // `key` so that a different child or avatar always starts from its own saved plan.
  return <PlanForm key={`${childId}/${avatarId}`} plan={plan.data} childId={childId} avatarId={avatarId} childName={childName} canTest={canTest} goBack={goBack} />;
}

export default ComfortPlan;
