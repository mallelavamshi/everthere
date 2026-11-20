import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion as fm } from 'framer-motion';
import { Button, Illustration, Screen } from '../../ui';
import { motion } from '../../theme/motion';
import { TryDemoSheet } from './TryDemoSheet';
import { StepHeading, useOnbPath } from './Step';

/**
 * Welcome: two doors (parent / daycare), "Join here" for invite codes, and the demo. Signed-in people with no role
 * yet land here too (their doors skip the sign-up and go straight to the profile steps).
 */
export interface WelcomeAccount {
  email: string;
  onSignOut: () => Promise<unknown> | void;
}

export function Welcome({ signedIn = false, account }: { signedIn?: boolean; account?: WelcomeAccount }) {
  const navigate = useNavigate();
  const p = useOnbPath();
  const [demo, setDemo] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const door = (d: 'parent' | 'daycare') => navigate(signedIn ? p(`/${d}/start`) : p(`/signup?door=${d}`));

  return (
    <Screen
      bg="sunGradient"
      footer={
        <div className="flex flex-col">
          <Button size="lg" fullWidth variant="sun" haptic onClick={() => door('parent')}>
            {"👩‍👧  I'm a parent"}
          </Button>
          <div className="h-3" />
          <Button size="lg" fullWidth variant="white" haptic onClick={() => door('daycare')}>
            {"🏫  I'm a daycare"}
          </Button>
          <div className="mt-2 flex flex-col items-center">
            <button
              type="button"
              onClick={() => navigate(p('/join'))}
              className="min-h-[44px] rounded-btn px-3 text-[15px] text-mutedText"
            >
              Got an invite code? <b className="font-semibold text-danger underline decoration-coral decoration-2 underline-offset-4">Join here</b>
            </button>
            {account ? (
              // A signed-in person with no role yet (wrong account, abandoned set-up) must never be stuck here.
              <p className="flex min-h-[44px] max-w-full items-center gap-1 px-3 text-[13px] text-mutedText">
                <span className="truncate">Signed in as {account.email}</span>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  disabled={signingOut}
                  onClick={async () => {
                    setSigningOut(true);
                    try {
                      await account.onSignOut();
                    } finally {
                      setSigningOut(false);
                    }
                  }}
                  className="min-h-[44px] shrink-0 rounded-btn px-1 font-semibold text-ink underline underline-offset-4 disabled:opacity-50"
                >
                  Sign out
                </button>
              </p>
            ) : null}
            {signedIn ? null : (
              <button type="button" onClick={() => setDemo(true)} className="min-h-[44px] rounded-btn px-3 text-[14px] font-medium text-mutedText underline underline-offset-4">
                Try the demo ✨
              </button>
            )}
          </div>
        </div>
      }
    >
      {/* The content block is centred in the space above the buttons; the hero takes whatever that space has to give,
          between a small floor on short phones and a crop-safe cap on tall ones (global.css .welcome-*, task 26c). */}
      <fm.div {...motion.page} className="welcome-body mx-auto flex min-h-full w-full max-w-[440px] flex-col items-center justify-center text-center">
        <div className="shrink-0 pt-1 text-[19px] font-bold text-ink">
          <span aria-hidden="true">💛 </span>EverThere
        </div>
        <fm.div
          animate={{ y: [0, -7, 0] }}
          transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut' }}
          className="welcome-hero mt-5"
          data-testid="welcome-hero"
        >
          <Illustration asset="onboarding.hero" size={440} priority fill />
        </fm.div>
        <StepHeading className="mt-5 shrink-0 text-[30px] [@media(min-height:860px)]:text-[34px]">
          Be there,{' '}
          <br />
          {"even when you can't."}
        </StepHeading>
        <p className="mx-4 mt-3 shrink-0 text-[16px] leading-snug text-mutedText [@media(min-height:860px)]:text-[17px]">
          Your face, your voice, your words — comforting your little one whenever they need you.
        </p>
      </fm.div>
      {signedIn ? null : <TryDemoSheet open={demo} onClose={() => setDemo(false)} />}
    </Screen>
  );
}
