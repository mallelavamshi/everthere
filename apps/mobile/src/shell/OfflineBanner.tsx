import { useOffline } from '../lib/native';

/** Slim banner pinned above everything while the device (or the last request) is offline. */
export function OfflineBanner() {
  const offline = useOffline();
  if (!offline) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] bg-mint pt-safe text-center text-[14px] font-semibold text-mintInk"
    >
      <p className="px-4 py-2">You're offline — we'll reconnect soon 💛</p>
    </div>
  );
}
