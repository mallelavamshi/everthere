import { useId, type ReactNode } from 'react';
import { motion as fm } from 'framer-motion';
import clsx from 'clsx';

export interface TabItem<K extends string = string> {
  key: K;
  label: string;
  icon: ReactNode;
  /** Small unread count bubble. */
  badge?: number;
}

export interface TabBarProps<K extends string = string> {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  className?: string;
}

export function TabBar<K extends string>({ items, value, onChange, className }: TabBarProps<K>) {
  const id = useId();
  return (
    <nav
      aria-label="Main"
      className={clsx('flex border-t-2 border-line bg-white pl-safe pr-safe pb-[max(var(--et-safe-bottom),6px)] pt-1.5', className)}
    >
      {items.map((it) => {
        const on = it.key === value;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onChange(it.key)}
            aria-current={on ? 'page' : undefined}
            title={it.label}
            aria-label={it.badge ? `${it.label}, ${it.badge} new` : it.label}
            className={clsx(
              'relative flex min-h-[56px] min-w-touch flex-1 flex-col items-center justify-center gap-0.5 text-[12px] leading-none',
              on ? 'font-semibold text-ink' : 'font-medium text-mutedText',
            )}
          >
            <span className="relative grid h-8 w-12 place-items-center text-[20px]">
              {on ? (
                <fm.span
                  layoutId={`${id}-pill`}
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full bg-sun/45"
                  transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                />
              ) : null}
              <span aria-hidden="true" className="relative">
                {it.icon}
              </span>
              {it.badge ? (
                <span
                  aria-hidden="true"
                  className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-white bg-coral px-1 text-[10px] font-bold text-ink"
                >
                  {it.badge > 9 ? '9+' : it.badge}
                </span>
              ) : null}
            </span>
            {/* Large system text: one line, ellipsis at the tab's edge rather than overflowing into the next tab. */}
            <span aria-hidden="true" className="block max-w-full truncate px-0.5 leading-tight">
              {it.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
