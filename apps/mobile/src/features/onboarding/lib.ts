import { CODE_ALPHABET, CODE_LENGTH } from '@everthere/shared';

// Pure helpers for the onboarding screens: invite codes, time zones, ages, password hints, friendly Clerk errors.

// ---- invite code -----------------------------------------------------------------------------------------------

/** Uppercase, keep only the invite alphabet (no 0/O/1/I/L), cap at six characters. */
export function normalizeCode(raw: string, max = CODE_LENGTH): string {
  let out = '';
  for (const ch of raw.toUpperCase()) if (CODE_ALPHABET.includes(ch) && out.length < max) out += ch;
  return out;
}

// ---- time zones ------------------------------------------------------------------------------------------------

export const FALLBACK_TIMEZONE = 'America/New_York';

export const US_ZONES: readonly { id: string; label: string }[] = [
  { id: 'America/New_York', label: 'Eastern Time' },
  { id: 'America/Chicago', label: 'Central Time' },
  { id: 'America/Denver', label: 'Mountain Time' },
  { id: 'America/Los_Angeles', label: 'Pacific Time' },
  { id: 'America/Anchorage', label: 'Alaska Time' },
  { id: 'Pacific/Honolulu', label: 'Hawaii Time' },
];

const validZone = (tz: unknown): tz is string => {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** The device's own IANA zone, or Eastern if the WebView will not say. */
export function defaultTimezone(): string {
  try {
    const tz = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && validZone(tz) ? tz : FALLBACK_TIMEZONE;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

/** "Eastern Time" for the US zones, "Kolkata (Asia)" for everything else. */
export function friendlyZone(tz: string): string {
  const us = US_ZONES.find((z) => z.id === tz);
  if (us) return us.label;
  const [region, ...rest] = tz.split('/');
  const city = (rest[rest.length - 1] ?? region ?? tz).replace(/_/g, ' ');
  return rest.length ? `${city} (${region})` : city;
}

/** Every IANA zone this WebView knows (empty if it cannot list them: the US six are still offered). */
export function allZones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    return fn ? fn('timeZone') : [];
  } catch {
    return [];
  }
}

// ---- age preview -----------------------------------------------------------------------------------------------

/** "3 years old 🎂", "14 months old 🍼", "Brand new! 👶"; null for a missing, impossible or future date. */
export function ageLabel(birthday: string, now: Date = new Date()): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const born = new Date(y, mo - 1, d);
  if (born.getFullYear() !== y || born.getMonth() !== mo - 1 || born.getDate() !== d) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (born.getTime() > today.getTime()) return null;
  let months = (today.getFullYear() - y) * 12 + (today.getMonth() - (mo - 1));
  if (today.getDate() < d) months -= 1;
  if (months < 1) return 'Brand new! 👶';
  if (months < 24) return `${months} month${months === 1 ? '' : 's'} old 🍼`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} old 🎂`;
}

/** Today as YYYY-MM-DD in local time (the date input's max). */
export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** YYYY-MM-DD for the date `yearsBack` years before `now` (local), clamped to the month's last day (Feb 29). */
function yearsAgoIso(now: Date, yearsBack: number): string {
  const y = now.getFullYear() - yearsBack;
  const last = new Date(y, now.getMonth() + 1, 0).getDate();
  return todayIso(new Date(y, now.getMonth(), Math.min(now.getDate(), last)));
}

/**
 * Birthday picker range for a daycare-age child: max today, min 12 years ago, and `start`, about 3 years ago, where an
 * empty picker opens (instead of today, which meant hunting through the year list; device test M-5).
 */
export function birthdayBounds(now: Date = new Date()): { max: string; min: string; start: string } {
  return { max: todayIso(now), min: yearsAgoIso(now, 12), start: yearsAgoIso(now, 3) };
}

// ---- passwords -------------------------------------------------------------------------------------------------

export const PASSWORD_MIN = 8;

export interface PasswordCheck {
  id: 'length' | 'mix';
  label: string;
  ok: boolean;
  /** Only the length rule blocks the button; "mix" is a friendly nudge. */
  required: boolean;
}

export function passwordChecks(pw: string): PasswordCheck[] {
  return [
    { id: 'length', label: `At least ${PASSWORD_MIN} characters`, ok: pw.length >= PASSWORD_MIN, required: true },
    { id: 'mix', label: 'A mix of letters and numbers is even better', ok: /[a-z]/i.test(pw) && /[0-9]/.test(pw), required: false },
  ];
}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

// ---- friendly Clerk errors -------------------------------------------------------------------------------------

export type ClerkField = 'email' | 'password' | 'code' | 'firstName' | 'lastName';
export interface FriendlyError {
  message: string;
  field?: ClerkField;
}

const BY_CODE: Record<string, FriendlyError> = {
  form_identifier_exists: { message: 'That email already has an EverThere account. Try signing in instead 💛', field: 'email' },
  form_password_pwned: { message: 'That password has shown up in a data breach. Please pick a different one.', field: 'password' },
  form_password_length_too_short: { message: 'Passwords need at least 8 characters.', field: 'password' },
  form_password_not_strong_enough: { message: 'Let’s make that password a little stronger: try adding a few more characters or a number.', field: 'password' },
  form_password_validation_failed: { message: 'Let’s make that password a little stronger: try adding a few more characters or a number.', field: 'password' },
  form_password_size_in_bytes_exceeded: { message: 'That password is a bit too long. Please shorten it.', field: 'password' },
  form_param_format_invalid: { message: "That email doesn't look quite right. Please check it.", field: 'email' },
  form_param_nil: { message: 'Please fill that in.' },
  form_identifier_not_found: { message: "That email and password don't match. Want to try again?", field: 'password' },
  form_password_incorrect: { message: "That email and password don't match. Want to try again?", field: 'password' },
  strategy_for_user_invalid: { message: "That email and password don't match. Want to try again?", field: 'password' },
  form_code_incorrect: { message: "That code isn't right. Check your email and try again.", field: 'code' },
  auth_incomplete: { message: 'Something needs a little more attention — please try again.' },
  verification_failed: { message: "That code isn't right. Check your email and try again.", field: 'code' },
  verification_expired: { message: 'That code has expired. Tap "Send a new code" and try again.', field: 'code' },
  too_many_requests: { message: "Lots of tries! Please wait a minute, then try again in a moment." },
  rate_limit_exceeded: { message: "Lots of tries! Please wait a minute, then try again in a moment." },
  session_exists: { message: "You're already signed in on this device." },
  identification_claimed: { message: 'That email already has an EverThere account. Try signing in instead 💛', field: 'email' },
  network_error: { message: "We can't reach EverThere. Check your connection and try again 💛" },
  requires_new_password: { message: 'Please choose a new password to keep going.', field: 'password' },
  // Clerk Protect (bot protection) could not run or finish in this WebView.
  protect_check_required: { message: "We couldn't finish a quick security check on this device. Please try again in a moment 💛" },
  protect_check_timed_out: { message: "We couldn't finish a quick security check on this device. Please try again in a moment 💛" },
  protect_check_unsupported_environment: {
    message: "We couldn't finish a quick security check on this device. Try updating Android System WebView, or sign up on another device and sign in here 💛",
  },
  captcha_invalid: { message: "We couldn't finish a quick security check on this device. Please try again in a moment 💛" },
};

const GENERIC: FriendlyError = { message: 'Something got tangled. Please try again in a moment 💛' };
const OFFLINE: FriendlyError = BY_CODE.network_error!;

interface ClerkishItem {
  code?: unknown;
  meta?: { paramName?: unknown };
}

/**
 * Turns whatever Clerk (or the network) threw into warm copy. Raw Clerk text is never returned: only the machine
 * `code` is read, and unknown codes get a generic line.
 */
export function friendlyClerkError(err: unknown): FriendlyError {
  if (err instanceof TypeError || (err && typeof err === 'object' && (err as { name?: string }).name === 'TypeError')) return OFFLINE;
  if (!err || typeof err !== 'object') return GENERIC;
  const e = err as { code?: unknown; status?: unknown; errors?: ClerkishItem[] };
  const items: ClerkishItem[] = [...(Array.isArray(e.errors) ? e.errors : []), { code: e.code }];
  for (const it of items) {
    const hit = typeof it.code === 'string' ? BY_CODE[it.code] : undefined;
    if (hit) return hit;
  }
  if (e.status === 429) return BY_CODE.too_many_requests!;
  // A parameter-level complaint we have no copy for: at least point at the right field.
  const param = items.map((i) => i.meta?.paramName).find((p) => typeof p === 'string');
  if (param === 'email_address') return { ...GENERIC, field: 'email' };
  if (param === 'password') return { ...GENERIC, field: 'password' };
  return GENERIC;
}

// ---- misc ------------------------------------------------------------------------------------------------------

/** Scrolls a focused field clear of the keyboard (after the WebView has resized). */
export function scrollIntoViewSoon(el: Element | null): void {
  if (!el || typeof (el as HTMLElement).scrollIntoView !== 'function') return;
  setTimeout(() => (el as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
}

/** Empty string when nothing was typed, else the trimmed value. */
export const clean = (v: string) => v.trim();
