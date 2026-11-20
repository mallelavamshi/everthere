import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion as fm } from 'framer-motion';
import clsx from 'clsx';
import { motion } from '../theme/motion';
import { toast, toastStore, type ToastKind } from './toast';

const look: Record<ToastKind, { icon: string; cls: string }> = {
  success: { icon: '🎉', cls: 'bg-mint' },
  error: { icon: '😕', cls: 'bg-flag' },
  info: { icon: '💡', cls: 'bg-white' },
};

/** Mount once at the root. A single polite live region announces toasts without stealing focus. */
export function Toaster() {
  const items = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot, toastStore.getSnapshot);
  // Portalled to <body> so it stays reachable when the app root is made inert behind a sheet.
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 px-4 pt-[max(var(--et-safe-top),12px)]"
    >
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <fm.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.15 } }}
            transition={motion.pop.transition}
            className={clsx(
              'pointer-events-auto flex w-full max-w-[420px] items-center gap-3 rounded-btn border-btn border-ink py-1.5 pl-4 pr-1.5 text-[15px] font-medium text-ink shadow-toast',
              look[t.kind].cls,
            )}
          >
            <span aria-hidden="true" className="text-[20px] leading-none">
              {t.icon ?? look[t.kind].icon}
            </span>
            <span className="flex-1 py-1.5 leading-snug">{t.message}</span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => toast.dismiss(t.id)}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[16px] hover:bg-ink/10"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </fm.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
