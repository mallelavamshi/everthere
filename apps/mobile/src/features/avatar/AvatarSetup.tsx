import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { AvatarView, Voice } from '@everthere/shared';
import { ApiError, friendlyMessage } from '../../lib/api';
import { toNapsterFrame, loadBitmap } from '../../lib/image';
import { bindFlowAvatar, markFlowStart } from '../../lib/flowHistory';
import { haptics } from '../../lib/native';
import { qk, useAvatar, useChildren } from '../../lib/queries';
import { EmptyState, Field, Screen } from '../../ui';
import { useSession } from '../../shell/SessionContext';
import { changePhoto, changeVoice, createAvatar, uploadMedia } from './avatarApi';
import { stockVoice } from './voices';
import { ConsentStep } from './ConsentStep';
import { PhotoStep } from './PhotoStep';
import { VoiceStep } from './VoiceStep';

/** What this run of the flow does. `new`: photo, voice, consent. `photo`: retake (photo, consent). `voice`: just the voice. */
export type SetupIntent = 'new' | 'photo' | 'voice';

const STEPS: Record<SetupIntent, ('photo' | 'voice' | 'consent')[]> = {
  new: ['photo', 'voice', 'consent'],
  photo: ['photo', 'consent'],
  voice: ['voice'],
};

const TITLES = ['Mom', 'Dad', 'Mommy', 'Daddy', 'Mama', 'Papa'];

const messageFor = (e: unknown) => friendlyMessage(e instanceof ApiError ? e.code : 'INTERNAL');

/** Mounted at /parent/avatar/{setup|retake|voice}/*. Holds the choices while the parent moves between the steps. */
export function AvatarSetup({ intent }: { intent: SetupIntent }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const qc = useQueryClient();
  const { me } = useSession();
  const avatars = useAvatar();
  const children = useChildren();
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [voice, setVoice] = useState<Voice | null>(null);
  const [parentTitle, setParentTitle] = useState('Mom');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploaded = useRef<{ photo: Blob; key: string } | null>(null);
  const submitted = useRef(false);

  const base = useMemo(() => pathname.replace(/\/(photo|voice|consent)\/?$/, '').replace(/\/$/, ''), [pathname]);
  const steps = STEPS[intent];
  const childName = children.data?.[0]?.name;
  const existing = avatars.data?.[0];
  const leave = intent === 'new' ? '/parent' : '/parent/avatar';
  const progress = (step: 'photo' | 'voice' | 'consent') => (steps.length > 1 ? { total: steps.length, current: steps.indexOf(step) + 1 } : null);
  const go = (step: string) => navigate(`${base}/${step}`);

  // Remember where the flow starts in the history, so approving can drop it again (device test M-8).
  useEffect(() => markFlowStart(), []);

  if (me.user.isDemo) {
    return (
      <Screen back={() => navigate(leave)}>
        <EmptyState asset="empty.resting" title="Look around, it's all yours" body={friendlyMessage('DEMO_READ_ONLY')} action={{ label: 'Back', onClick: () => navigate(leave) }} />
      </Screen>
    );
  }
  if (avatars.isPending) return <Screen />;
  // Editing needs something to edit; a brand-new setup is pointless when one exists (unless we are mid-submit).
  if (intent !== 'new' && !existing) return <Navigate to="/parent/avatar/setup" replace />;
  if (intent === 'new' && existing && !submitted.current) return <Navigate to="/parent/avatar" replace />;

  const afterSave = (a: AvatarView) => {
    submitted.current = true;
    bindFlowAvatar(a.id);
    haptics.success();
    void qc.invalidateQueries({ queryKey: qk.avatar() });
    navigate(a.status === 'ready' ? `/parent/avatar/test/${a.id}` : `/parent/avatar/creating/${a.id}`, { replace: true });
  };

  const run = async (job: () => Promise<AvatarView>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      afterSave(await job());
    } catch (e) {
      haptics.error();
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  };

  /** Napster wants a 16:9 frame: build it, upload it once (a retry reuses the stored key), return the key. */
  const photoKey = async (p: Blob): Promise<string> => {
    if (uploaded.current?.photo === p) return uploaded.current.key;
    const bmp = await loadBitmap(p);
    try {
      const frame = await toNapsterFrame(bmp);
      const { key } = await uploadMedia(frame, 'avatar', 'avatar.jpg');
      uploaded.current = { photo: p, key };
      return key;
    } finally {
      if ('close' in bmp) bmp.close();
    }
  };

  const titleField = (
    <div className="flex flex-col gap-2">
      <Field
        label={`What does ${childName ?? 'your little one'} call you?`}
        value={parentTitle}
        maxLength={20}
        autoCapitalize="words"
        onChange={(e) => setParentTitle(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        {TITLES.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={parentTitle === t}
            onClick={() => setParentTitle(t)}
            className={`min-h-[44px] rounded-full border-2 border-ink px-4 text-[15px] font-medium ${parentTitle === t ? 'bg-sun' : 'bg-white'}`}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <Routes>
      <Route index element={<Navigate to={steps[0]!} replace />} />
      <Route
        path="photo"
        element={
          <PhotoStep
            childName={childName}
            steps={progress('photo')}
            onBack={() => navigate(leave)}
            onPhoto={(p) => {
              setPhoto(p);
              go(steps[1]!);
            }}
          />
        }
      />
      <Route
        path="voice"
        element={
          intent === 'voice' ? (
            <VoiceStep
              value={voice ?? stockVoice(existing?.voiceId) ?? null}
              onChange={setVoice}
              steps={null}
              busy={busy}
              error={error}
              ctaLabel="Save this voice"
              onBack={() => navigate(leave)}
              onNext={() => {
                const v = voice ?? stockVoice(existing?.voiceId);
                if (existing && v) void run(() => changeVoice(existing.id, v));
              }}
            />
          ) : (
            <VoiceStep value={voice} onChange={setVoice} steps={progress('voice')} onBack={() => go('photo')} onNext={() => go('consent')} />
          )
        }
      />
      <Route
        path="consent"
        element={
          // A reload loses the photo (it only lives in memory): start again from the camera.
          !photo || (intent === 'new' && !voice) ? (
            <Navigate to={`${base}/photo`} replace />
          ) : (
            <ConsentStep
              steps={progress('consent')}
              busy={busy}
              error={error}
              ctaLabel={intent === 'photo' ? 'Save my new photo ✨' : 'Create my avatar ✨'}
              onBack={() => go(steps[steps.length - 2]!)}
              before={intent === 'new' ? titleField : undefined}
              blocked={intent === 'new' && parentTitle.trim() === ''}
              onSubmit={({ consentName }) =>
                void run(async () => {
                  const key = await photoKey(photo);
                  const consent = { consentName, consentAccepted: true } as const;
                  if (intent === 'photo' && existing) return changePhoto(existing.id, key, consent);
                  return createAvatar({ photoKey: key, voiceId: voice!, parentTitle: parentTitle.trim(), ...consent });
                })
              }
            />
          )
        }
      />
      <Route path="*" element={<Navigate to={steps[0]!} replace />} />
    </Routes>
  );
}
