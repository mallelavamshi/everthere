import { EmptyState } from './EmptyState';

export interface ErrorStateProps {
  onRetry?: () => void;
  retrying?: boolean;
  /** Use the offline illustration and copy. */
  offline?: boolean;
  title?: string;
  body?: string;
  className?: string;
}

/**
 * Friendly error state with retry. Deliberately takes no error object: raw error text is never shown to users.
 * Log the real error where it is caught.
 */
export function ErrorState({ onRetry, retrying, offline, title, body, className }: ErrorStateProps) {
  return (
    <EmptyState
      className={className}
      asset={offline ? 'empty.offline' : 'empty.error'}
      title={title ?? (offline ? "You're offline" : "Hmm, that didn't work")}
      body={body ?? (offline ? 'Check your connection and we will pick up right where you left off.' : 'Something got tangled on our end. Give it another try.')}
      action={onRetry ? { label: 'Try again', onClick: onRetry, loading: retrying } : undefined}
    />
  );
}
