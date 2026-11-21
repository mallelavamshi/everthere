import type { ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { Button, EmptyState } from '../../ui';
import { errorView } from '../errorViews';

/** Covers the live screen (the SDK's container stays mounted underneath; React never removes its DOM). */
export function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center overflow-y-auto bg-cream px-4 pb-safe pt-safe">
      <div className="w-full max-w-[460px]">{children}</div>
    </div>
  );
}

export function LiveError({ code, mode, childName, parentTitle, onRetry, onBack }: { code?: string; mode: 'test' | 'child'; childName?: string; parentTitle: string; onRetry: () => void; onBack: () => void }) {
  const v = errorView(code, { mode, childName, parentTitle, web: !Capacitor.isNativePlatform() });
  return (
    <div className="flex flex-col items-center">
      <EmptyState asset={v.asset} title={v.title} body={v.body} action={v.retry ? { label: 'Try again', onClick: onRetry } : undefined} />
      <Button variant="ghost" onClick={onBack}>
        Go back
      </Button>
    </div>
  );
}

export function EndCard({ reason, mode, parentTitle, onContinue }: { reason?: string; mode: 'test' | 'child'; parentTitle: string; onContinue: () => void }) {
  return (
    <EmptyState
      asset="moment.feltBetter"
      size={200}
      title={reason === 'max' ? 'Time for a hug break 💛' : mode === 'test' ? 'Test call finished' : 'Bye-bye for now 💛'}
      body={
        reason === 'max'
          ? `${parentTitle} sends the biggest squeeze. Let's take a little break and play.`
          : mode === 'test'
            ? `That is how ${parentTitle}'s avatar will feel to your little one.`
            : `${parentTitle} loves you to the moon and back.`
      }
      action={{ label: 'Continue', onClick: onContinue }}
    />
  );
}
