// The live screen is its own route (/live/child) and only hands back `{ endedSessionId }`. What the check-in needs to
// say ("How's Mia now?", "Send to Sarah") is remembered here, in memory, from the moment the call is started until
// the check-in is done or skipped. Losing it (app killed mid-call) just means we return to the roster.

export interface PendingCall {
  childId: string;
  childName: string;
  parentTitle: string;
  parentName?: string;
  startedAt: number;
}

let pending: PendingCall | null = null;

export const rememberCall = (c: PendingCall): void => {
  pending = c;
};
export const peekCall = (): PendingCall | null => pending;
export const clearCall = (): void => {
  pending = null;
};
