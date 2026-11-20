// "Who's teaching?" opens by itself once per app session (per person: cleared with the rest of their on-device state
// on sign-out / account change, and when the tablet is unregistered). The roster remounts after every call, so the flag lives here
// rather than in a component. Expiry of a shift opens the sheet directly and does not depend on it.

export const switchPrompt = { shown: false };
export const resetSwitchPrompt = (): void => {
  switchPrompt.shown = false;
};
