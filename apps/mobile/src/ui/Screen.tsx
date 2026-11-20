import type { ReactNode } from 'react';
import clsx from 'clsx';
import { colors, gradients } from '../theme/tokens';
import { useStatusBar } from '../lib/native';
import { Avatar } from './Avatar';
import { useProfileTrigger } from './profileContext';

export interface TopBarProps {
  title?: string;
  /** Shows a back arrow that calls this. */
  back?: () => void;
  actions?: ReactNode;
  className?: string;
}

export function TopBar({ title, back, actions, className }: TopBarProps) {
  const profile = useProfileTrigger();
  return (
    <header
      className={clsx(
        'sticky top-0 z-10 grid shrink-0 grid-cols-[minmax(44px,auto)_1fr_minmax(44px,auto)] items-center gap-1 px-2 pb-1 pt-2',
        className,
      )}
    >
      <div className="flex justify-start">
        {back ? (
          <button
            type="button"
            aria-label="Back"
            onClick={back}
            className="grid h-11 w-11 place-items-center rounded-full text-[24px] leading-none text-ink active:bg-ink/10"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : null}
      </div>
      {title ? <h1 className="truncate text-center text-[19px] font-semibold leading-tight text-ink">{title}</h1> : <span />}
      <div className="flex min-w-[44px] items-center justify-end gap-1">
        {actions}
        {profile ? (
          <button
            type="button"
            aria-label="Open profile"
            onClick={profile.open}
            className="grid h-11 w-11 place-items-center rounded-full active:bg-ink/10"
          >
            <Avatar name={profile.name} size={36} />
          </button>
        ) : null}
      </div>
    </header>
  );
}

export interface ScreenProps {
  title?: string;
  back?: () => void;
  actions?: ReactNode;
  bg?: 'cream' | 'sunGradient';
  /** Horizontal + bottom padding around the scrollable body (default true). */
  padded?: boolean;
  /** Sticky footer slot, e.g. a "Save" button or a TabBar. */
  footer?: ReactNode;
  /** Pad the footer slot (default true). Pass false for a TabBar, which draws its own chrome. */
  footerPadded?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * Full-height screen: safe-area aware, sticky TopBar, scrollable body, optional sticky footer.
 * Fills its parent (the app root is 100% height).
 */
export function Screen({ title, back, actions, bg = 'cream', padded = true, footer, footerPadded = true, className, children }: ScreenProps) {
  useStatusBar(bg);
  const hasBar = !!(title || back || actions);
  return (
    <div
      className={clsx('flex h-full min-h-0 w-full flex-col overflow-hidden pl-safe pr-safe text-ink', className)}
      style={{ background: bg === 'sunGradient' ? gradients.sunGradient : colors.cream }}
    >
      <div className="pt-safe shrink-0" />
      {hasBar ? <TopBar title={title} back={back} actions={actions} /> : null}
      <main className={clsx('min-h-0 flex-1 overflow-y-auto overscroll-contain', padded && 'px-4 pb-4 pt-2')}>{children}</main>
      {footer ? (
        <footer
          className={clsx(
            'shrink-0',
            footerPadded && 'px-4 pt-3 pb-[max(var(--et-safe-bottom),16px)]',
          )}
        >
          {footer}
        </footer>
      ) : (
        <div className="pb-safe shrink-0" />
      )}
    </div>
  );
}
