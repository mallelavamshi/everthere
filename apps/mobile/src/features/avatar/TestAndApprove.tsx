import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion as fm } from 'framer-motion';
import { ApiError, friendlyMessage } from '../../lib/api';
import { clearFlow, leaveFlow } from '../../lib/flowHistory';
import { haptics } from '../../lib/native';
import { qk } from '../../lib/queries';
import { motion } from '../../theme/motion';
import { Button, ErrorState, Illustration, Screen, Skeleton } from '../../ui';
import { InlineError } from '../onboarding/Step';
import { approveAvatar, fetchAvatar } from './avatarApi';
import { Confetti } from './Confetti';
import { voiceLabel } from './voices';

export interface TestAndApproveProps {
  avatarId: string;
  /** Where "Back home" goes (default /parent). */
  home?: string;
}

/**
 * Test call, then "How did that feel?" with Approve / Retake photo / Change voice.
 * The call itself is the live screen (/live/test); it returns here with `{ endedSessionId }` in the route state.
 */
export function TestAndApprove({ avatarId, home = '/parent' }: TestAndApproveProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [...qk.avatar(), avatarId], queryFn: ({ signal }) => fetchAvatar(avatarId, signal) });
  const [celebrate, setCelebrate] = useState(false);
  const tested = location.state != null;
  const a = q.data;

  // Still being made (or failed): the creating screen owns those states.
  useEffect(() => {
    if (a && (a.status === 'creating' || a.status === 'failed')) navigate(`/parent/avatar/creating/${avatarId}`, { replace: true });
  }, [a, avatarId, navigate]);

  const approve = useMutation({
    mutationFn: () => approveAvatar(avatarId),
    onSuccess: () => {
      haptics.success();
      setCelebrate(true);
      void qc.invalidateQueries({ queryKey: qk.avatar() });
    },
    onError: () => haptics.error(),
  });

  const startCall = () => {
    if (!a) return;
    navigate('/live/test', { state: { avatarId, parentTitle: a.parentTitle, returnTo: location.pathname } });
  };

  if (q.isError) {
    return (
      <Screen back={() => navigate(home)}>
        <ErrorState onRetry={() => void q.refetch()} retrying={q.isFetching} body={q.error instanceof ApiError ? friendlyMessage(q.error.code) : undefined} />
      </Screen>
    );
  }
  if (!a) {
    return (
      <Screen>
        <div className="flex flex-col items-center gap-4 pt-10">
          <Skeleton shape="circle" width={160} height={160} />
          <Skeleton shape="line" width={220} />
        </div>
      </Screen>
    );
  }

  // ---- approved ------------------------------------------------------------------------------------------------
  if (celebrate) {
    return (
      <Screen bg="sunGradient">
        <Confetti />
        <fm.div {...motion.pop} className="flex min-h-full flex-col items-center justify-center gap-4 text-center">
          <Illustration asset="moment.avatarApproved" size={320} priority />
          <h1 className="text-[28px] font-semibold leading-tight">Your avatar is approved! 💛</h1>
          <p className="max-w-[20rem] text-[16px] leading-relaxed text-mutedText">Your little one can meet you whenever they need a hug. You did something lovely today.</p>
          <Button size="lg" haptic onClick={() => leaveFlow(avatarId, navigate, home)}>
            Back home
          </Button>
        </fm.div>
      </Screen>
    );
  }

  // ---- before the call -----------------------------------------------------------------------------------------
  if (!tested) {
    return (
      <Screen bg="sunGradient" back={() => navigate(home)}>
        <fm.div {...motion.page} className="flex min-h-full flex-col items-center justify-center gap-4 text-center">
          <Illustration asset="moment.testCall" size={200} priority />
          <h1 className="text-[26px] font-semibold leading-tight">Time for a test call 📞</h1>
          <p className="max-w-[20rem] text-[16px] leading-relaxed text-mutedText">
            Say hello to your avatar! You'll hear the {voiceLabel(a.voiceId)} voice and see how it will meet your little one.
          </p>
          <Button size="lg" icon="🎥" haptic onClick={startCall}>
            Start test call
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              clearFlow();
              navigate(home);
            }}
          >
            Maybe later
          </Button>
        </fm.div>
      </Screen>
    );
  }

  // ---- after the call ------------------------------------------------------------------------------------------
  const already = a.status === 'approved';
  return (
    <Screen bg="sunGradient" back={() => navigate(home)}>
      <fm.div {...motion.page} className="flex min-h-full flex-col items-center justify-center gap-4 text-center">
        <Illustration asset="moment.feltBetter" size={168} priority />
        <h1 className="text-[28px] font-semibold leading-tight">How did that feel?</h1>
        <p className="max-w-[20rem] text-[16px] leading-relaxed text-mutedText">
          {already ? 'Your avatar is already approved. You can approve again after any change.' : 'If it looks and sounds like you, approve it. If not, change the photo or voice and test again.'}
        </p>
        <div className="flex w-full max-w-[22rem] flex-col gap-3">
          {!already ? (
            <Button size="lg" fullWidth haptic loading={approve.isPending} onClick={() => approve.mutate()}>
              Approve my avatar 💛
            </Button>
          ) : null}
          <Button variant="white" fullWidth icon="📸" onClick={() => navigate('/parent/avatar/retake')}>
            Retake photo
          </Button>
          <Button variant="white" fullWidth icon="🎙️" onClick={() => navigate('/parent/avatar/voice')}>
            Change voice
          </Button>
          <Button variant="ghost" fullWidth onClick={startCall}>
            Try another test call
          </Button>
        </div>
        {approve.isError ? (
          <InlineError message={approve.error instanceof ApiError ? friendlyMessage(approve.error.code) : friendlyMessage('INTERNAL')} onRetry={() => approve.mutate()} retrying={approve.isPending} />
        ) : null}
      </fm.div>
    </Screen>
  );
}
