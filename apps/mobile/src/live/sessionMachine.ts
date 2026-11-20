import type { FlagCategory, Severity } from '@everthere/shared';

// Pure state machine for one live session (test call or caregiver session).
//   idle -> connecting -> live -> ending -> ended, plus failed.
// Every event that needs "now" carries it (`at`), so the reducer stays pure and testable.

export type SessionState = 'idle' | 'connecting' | 'live' | 'ending' | 'ended' | 'failed';
export type CaptionRole = 'avatar' | 'child';
export type EndReason = 'user' | 'max' | 'remote' | 'expired' | 'pause' | 'unmount';

export interface Caption {
  id: string;
  role: CaptionRole;
  text: string;
}

export interface FlagRecord {
  category: FlagCategory;
  quote: string;
  severity: Severity;
  at: number;
}

export interface SessionContext {
  sessionId?: string;
  /** When the avatar went live (not when the call was tapped or the session created). */
  startedAt?: number;
  /** When a live call was asked to end (or ended by itself); with startedAt, the live length (P-7). */
  endedAt?: number;
  /** The last CAPTIONS_SHOWN bubbles, oldest first. */
  captions: Caption[];
  /** Ids pushed out of `captions`, so a late delta for them does not resurrect an old bubble. */
  retiredCaptionIds: string[];
  /** The last COMPLETED line (never a partial delta), for the screen-reader live region. */
  announce?: Caption;
  flags: FlagRecord[];
  /** The flag banner shows until this time. */
  bannerUntil?: number;
  wobbly: boolean;
  /** When the wobbly toast last fired (throttle anchor). */
  wobblyAt?: number;
  warnShown: boolean;
  /** The SDK reported user inactivity (only if its inactivity timer is somehow on). */
  inactive: boolean;
  error?: string;
  endReason?: EndReason;
}

export interface Machine {
  state: SessionState;
  ctx: SessionContext;
}

export type SessionEvent =
  | { type: 'START' }
  | { type: 'SESSION'; sessionId: string }
  | { type: 'AVATAR_READY'; at: number }
  | { type: 'CAPTION'; id: string; role: CaptionRole; text: string; mode: 'append' | 'replace' }
  | { type: 'FLAG'; category: FlagCategory; quote: string; severity: Severity; at: number }
  | { type: 'WARN_TIME' }
  | { type: 'CONNECTION_WARNING'; at: number }
  | { type: 'INACTIVE'; value: boolean }
  | { type: 'END_REQUESTED'; reason: EndReason; at?: number }
  | { type: 'ENDED'; reason?: EndReason; at?: number }
  | { type: 'ERROR'; code: string };

export const CAPTIONS_SHOWN = 2;
export const BANNER_MS = 6_000;
export const WOBBLY_THROTTLE_MS = 20_000;
const RETIRED_KEEP = 24;

const freshContext = (): SessionContext => ({
  captions: [],
  retiredCaptionIds: [],
  flags: [],
  wobbly: false,
  warnShown: false,
  inactive: false,
});

export const initialMachine: Machine = { state: 'idle', ctx: freshContext() };

const active = (s: SessionState) => s === 'connecting' || s === 'live';

function caption(ctx: SessionContext, e: Extract<SessionEvent, { type: 'CAPTION' }>): SessionContext | null {
  if (ctx.retiredCaptionIds.includes(e.id)) return null;
  const i = ctx.captions.findIndex((c) => c.id === e.id);
  if (i >= 0) {
    const cur = ctx.captions[i]!;
    const text = e.mode === 'append' ? cur.text + e.text : e.text;
    if (text === cur.text) return null;
    // A line completed as empty (nothing was really said): drop its bubble rather than show it empty (P-5).
    if (!text.trim()) return { ...ctx, captions: ctx.captions.filter((c) => c.id !== e.id) };
    const captions = ctx.captions.slice();
    captions[i] = { ...cur, text };
    return { ...ctx, captions };
  }
  if (!e.text.trim()) return null;
  const all = [...ctx.captions, { id: e.id, role: e.role, text: e.text }];
  const dropped = all.slice(0, Math.max(0, all.length - CAPTIONS_SHOWN)).map((c) => c.id);
  return {
    ...ctx,
    captions: all.slice(-CAPTIONS_SHOWN),
    retiredCaptionIds: dropped.length ? [...ctx.retiredCaptionIds, ...dropped].slice(-RETIRED_KEEP) : ctx.retiredCaptionIds,
  };
}

/** The end of the live part, only for a call that went live. */
const liveEnd = (m: Machine, at: number | undefined): number | undefined =>
  m.ctx.endedAt ?? (m.state === 'live' && m.ctx.startedAt !== undefined ? at : undefined);

export function sessionMachine(m: Machine, e: SessionEvent): Machine {
  const { state, ctx } = m;
  switch (e.type) {
    case 'START':
      if (state === 'idle' || state === 'ended' || state === 'failed') return { state: 'connecting', ctx: freshContext() };
      return m;
    case 'SESSION':
      if (state !== 'connecting') return m;
      return { state, ctx: { ...ctx, sessionId: e.sessionId } };
    case 'AVATAR_READY':
      if (state !== 'connecting') return m;
      return { state: 'live', ctx: { ...ctx, startedAt: e.at } };
    case 'CAPTION': {
      // Accepted while connecting too: the opening line can start streaming before onAvatarReady.
      if (!active(state)) return m;
      const next = caption(ctx, e);
      const done = e.mode === 'replace' && !!e.text.trim() && !ctx.retiredCaptionIds.includes(e.id);
      if (!next && !done) return m;
      const base = next ?? ctx;
      if (!done) return { state, ctx: base };
      const announce = { id: e.id, role: e.role, text: e.text };
      const same = ctx.announce && ctx.announce.id === announce.id && ctx.announce.text === announce.text;
      return same && !next ? m : { state, ctx: { ...base, announce: same ? ctx.announce : announce } };
    }
    case 'FLAG':
      if (!active(state)) return m;
      return {
        state,
        ctx: { ...ctx, flags: [...ctx.flags, { category: e.category, quote: e.quote, severity: e.severity, at: e.at }], bannerUntil: e.at + BANNER_MS },
      };
    case 'WARN_TIME':
      if (state !== 'live' || ctx.warnShown) return m;
      return { state, ctx: { ...ctx, warnShown: true } };
    case 'CONNECTION_WARNING':
      if (!active(state)) return m;
      if (ctx.wobblyAt !== undefined && e.at - ctx.wobblyAt < WOBBLY_THROTTLE_MS) return m;
      return { state, ctx: { ...ctx, wobbly: true, wobblyAt: e.at } };
    case 'INACTIVE':
      if (state !== 'live' || ctx.inactive === e.value) return m;
      return { state, ctx: { ...ctx, inactive: e.value } };
    case 'END_REQUESTED':
      if (!active(state)) return m;
      return { state: 'ending', ctx: { ...ctx, endReason: e.reason, endedAt: liveEnd(m, e.at) } };
    case 'ENDED':
      if (!active(state) && state !== 'ending') return m;
      return { state: 'ended', ctx: { ...ctx, endReason: ctx.endReason ?? e.reason ?? 'remote', inactive: false, endedAt: ctx.endedAt ?? liveEnd(m, e.at) } };
    case 'ERROR':
      // Once the caregiver asked to end, a late error must not replace the goodbye with an error screen.
      if (!active(state)) return m;
      return { state: 'failed', ctx: { ...ctx, error: e.code } };
    default:
      return m;
  }
}
