/** Where a tapped alert (or its notification) goes. */
export function routeForAlert(kind: string, refId: string | null | undefined): string {
  if ((kind === 'summary' || kind === 'flag') && refId) return `/parent/sessions/${encodeURIComponent(refId)}`;
  if (kind === 'avatar_ready') return '/parent/avatar';
  if (kind === 'invite') return '/parent/caregivers';
  return '/parent/alerts';
}
