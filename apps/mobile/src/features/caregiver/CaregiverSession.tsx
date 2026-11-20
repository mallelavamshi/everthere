import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from '../../ui';
import { CheckIn } from './CheckIn';
import { clearCall, peekCall } from './pendingCall';

/**
 * Where the live call (/live/child, started from the roster) returns to. `onDone(sessionId, durationS)` of the live
 * screen arrives as `state.endedSessionId` / `state.endedDurationS`, set only when the call really went live. Without
 * a session there is nothing to check in on: go back to the roster with a gentle note. The length shown is the
 * call's own (the server's duration, else the live time), never the time since the teacher tapped (P-7).
 */
export function CaregiverSession() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const ended = state as { endedSessionId?: string; endedDurationS?: number } | null;
  const sessionId = ended?.endedSessionId;
  const durationS = typeof ended?.endedDurationS === 'number' ? ended.endedDurationS : undefined;
  const call = peekCall();

  useEffect(() => {
    if (sessionId && call) return;
    if (call) toast.info(`${call.childName}'s call didn't connect. No worries, try again whenever you're ready 💛`);
    clearCall();
    navigate('/caregiver', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!sessionId || !call) return null;
  return (
    <CheckIn
      sessionId={sessionId}
      childName={call.childName}
      parentTitle={call.parentTitle}
      parentName={call.parentName}
      durationS={durationS}
      onDone={() => {
        clearCall();
        navigate('/caregiver', { replace: true });
      }}
    />
  );
}
