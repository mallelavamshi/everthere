import { Illustration } from '../ui';

/** Branded splash while Clerk and the first /api/me load: cream, the wordmark, a gentle pulse. */
export function Splash() {
  return (
    <div className="grid h-full w-full place-items-center bg-cream" role="status" aria-label="Loading EverThere">
      <Illustration asset="brand.wordmark" size={240} priority className="animate-pulse motion-reduce:animate-none" />
    </div>
  );
}
