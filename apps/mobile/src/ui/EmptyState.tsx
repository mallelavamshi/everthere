import type { ReactNode } from 'react';
import { motion as fm } from 'framer-motion';
import clsx from 'clsx';
import type { AssetKey } from '../assets/manifest';
import { motion } from '../theme/motion';
import { Button } from './Button';
import { Illustration } from './Illustration';

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  loading?: boolean;
}

export interface EmptyStateProps {
  asset: AssetKey;
  title: string;
  body?: string;
  /** A ready-made element, or { label, onClick } for the standard sun button. */
  action?: ReactNode | EmptyStateAction;
  /** Illustration width in px (default 176). */
  size?: number;
  className?: string;
}

function isActionSpec(a: unknown): a is EmptyStateAction {
  return !!a && typeof a === 'object' && 'label' in a && 'onClick' in a && !('$$typeof' in a);
}

export function EmptyState({ asset, title, body, action, size = 176, className }: EmptyStateProps) {
  return (
    <div className={clsx('flex flex-col items-center px-6 py-8 text-center', className)}>
      <fm.div {...motion.pop} className="relative mb-4 grid place-items-center">
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 -z-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sun/25"
          style={{ width: size * 0.92, height: size * 0.92 }}
        />
        <Illustration asset={asset} size={size} className="relative" />
      </fm.div>
      <h2 className="text-[22px] font-semibold leading-tight text-ink">{title}</h2>
      {body ? <p className="mt-2 max-w-[19rem] text-[15px] leading-relaxed text-mutedText">{body}</p> : null}
      {action ? (
        <div className="mt-5">
          {isActionSpec(action) ? (
            <Button onClick={action.onClick} loading={action.loading}>
              {action.label}
            </Button>
          ) : (
            (action as ReactNode)
          )}
        </div>
      ) : null}
    </div>
  );
}
