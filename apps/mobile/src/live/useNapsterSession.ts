import { useEffect, useRef, useState, type RefObject } from 'react';
import { LIMITS, type FlagCategory, type SessionContextView, type SessionSong, type Severity } from '@everthere/shared';
import { api, ApiError, type ApiInit } from '../lib/api';
import { haptics, useAppBackground } from '../lib/native';
import { toast } from '../ui/toast';
import { parseCaption, parseFlagCall, sdkErrorCode, type LiveEvent } from './events';
import { useKeepAwake } from './keepAwake';
import { preflightMic, type MicCheck } from './micPreflight';
import { napsterSdk, type LiveCallbacks, type LiveCommand, type LiveInstance, type LiveSdk, type SdkStatus } from './sdk';
import { initialMachine, sessionMachine, type EndReason, type Machine, type SessionEvent } from './sessionMachine';

export interface StartResult {
  sessionId: string;
  token: string;
}

export type LiveRequest = (path: string, init?: ApiInit) => Promise<unknown>;

export interface UseNapsterSessionOptions {
  /** Creates the EverThere session (POST /api/sessions or the avatar test-session route). Called by the SDK's getToken. */
  start: () => Promise<StartResult>;
  /** Called once a session that had a server id reaches `ended`. */
  onEnded?: (sessionId: string) => void;
  /** Defaults to the real Napster SDK. */
  sdk?: LiveSdk;
  /** Defaults to the EverThere API client. */
  request?: LiveRequest;
  /** Defaults to LIMITS.sessionWarnMs / sessionMaxMs. DEV previews shorten them. */
  limits?: { warnMs: number; maxMs: number };
  /** Settles the mic permission before connecting (task 26c round 2). Defaults to preflightMic. */
  micCheck?: () => Promise<MicCheck>;
}

export const WOBBLY_COPY = "Connection's a bit wobbly…";
/** Upper bound for any single teardown wait (init settling, destroy, POST /end). The UI never sticks in `ending`. */
export const BOUND_MS = 5_000;
/** The agent times a function call out after 10 s; answer well before that, whatever the flag POST is doing. */
export const FLAG_OUTPUT_DEADLINE_MS = 3_500;
/** Still connecting after this long (and not waiting on the mic prompt): give up with a friendly network-style error. */
export const CONNECT_TIMEOUT_MS = 45_000;
export const CONTEXT_RETRY_MS = 1_000;

/** One begin(): its SDK instance, its server session and everything that must happen at most once for it. */
interface Attempt {
  initP: Promise<LiveInstance | null>;
  inst: LiveInstance | null;
  tokenUsed: boolean;
  sessionId?: string;
  serverEnds: Map<string, Promise<void>>;
  /** destroy() was called on this attempt's instance (by us or by the SDK itself). */
  destroyed: boolean;
  teardownP?: Promise<void>;
  endP?: Promise<void>;
  failed: boolean;
  flagCalls: Set<string>;
  contextSent: boolean;
  /** `durationS` from POST /end: the server's own length of the call (P-7). */
  serverDurationS?: number;
}

/** Resolves with `p`'s value, or undefined after `ms`. */
function bounded<T>(p: Promise<T>, ms = BOUND_MS): Promise<T | undefined> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<undefined>((r) => (t = setTimeout(() => r(undefined), ms)))]).finally(() => clearTimeout(t));
}

// The SDK is a singleton (a second init() before destroy() throws ALREADY_INITIALIZED), and a child can have
// only one active session (a new start before the old POST /end lands is SESSION_ACTIVE). Every destroy and
// every POST /end is tracked here, each piece bounded, and every init waits for the chain.
let sdkIdle: Promise<void> = Promise.resolve();
function track(p: Promise<unknown>): void {
  const piece = bounded(p.then(() => undefined, () => undefined));
  sdkIdle = Promise.all([sdkIdle, piece]).then(() => undefined);
}
/** Test-only: forget pending teardown work from a previous test. */
export function __resetLiveChainForTests(): void {
  sdkIdle = Promise.resolve();
}

/** The context's song, if it is a usable one (a non-empty title; lyrics only when they are a non-empty string). */
function songFrom(r: unknown): SessionSong | undefined {
  const song = (r as Partial<SessionContextView> | null | undefined)?.song as { title?: unknown; lyrics?: unknown } | undefined;
  const title = typeof song?.title === 'string' ? song.title.trim() : '';
  if (!title) return undefined;
  const lyrics = typeof song?.lyrics === 'string' ? song.lyrics.trim() : '';
  return lyrics ? { title, lyrics } : { title };
}

const codeOf = (e: unknown): string => (e instanceof ApiError ? e.code : 'INTERNAL');

export function useNapsterSession(opts: UseNapsterSessionOptions) {
  const [machine, setMachine] = useState<Machine>(initialMachine);
  const [sdkStatus, setSdkStatusState] = useState<SdkStatus | null>(null);
  const [muted, setMuted] = useState(false);
  const [volume, setVolumeState] = useState(1);
  /** "Our song" from the server's session context (the single source for real calls). */
  const [song, setSong] = useState<SessionSong | undefined>(undefined);
  /** The mic pre-flight is running (Android's system dialog may be up): no connect timeout, no backgrounding. */
  const [micPending, setMicPendingState] = useState(false);
  const micPendingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const machineRef = useRef(machine);
  const sdkStatusRef = useRef<SdkStatus | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const att = useRef<Attempt | null>(null);

  // The machine mirror lets SDK callbacks read the current state synchronously.
  const send = (e: SessionEvent) => {
    const next = sessionMachine(machineRef.current, e);
    if (next === machineRef.current) return;
    machineRef.current = next;
    setMachine(next);
  };
  const setMicPending = (v: boolean) => {
    micPendingRef.current = v;
    setMicPendingState(v);
  };
  const setSdkStatus = (s: SdkStatus | null) => {
    sdkStatusRef.current = s;
    setSdkStatusState(s);
  };

  const request: LiveRequest = (path, init) => (optsRef.current.request ?? api)(path, init);
  const over = (a: Attempt) => att.current !== a || !!a.endP || a.failed;

  const command = (a: Attempt, cmd: LiveCommand) => {
    void a.initP.then((inst) => {
      if (inst && !a.destroyed && att.current === a) {
        try {
          inst.sendCommand(cmd);
        } catch (e) {
          console.warn('live: sendCommand failed', e);
        }
      }
    });
  };

  /** POST /end once per server session; tracked so the next init (a quick Try again) waits for the slot to free. */
  const endOnServer = (a: Attempt, sessionId: string): Promise<void> => {
    const known = a.serverEnds.get(sessionId);
    if (known) return known;
    const p = request(`/sessions/${encodeURIComponent(sessionId)}/end`, { method: 'POST' }).then(
      (r) => {
        const d = (r as { durationS?: unknown } | null | undefined)?.durationS;
        if (sessionId === a.sessionId && typeof d === 'number' && Number.isFinite(d) && d >= 0) a.serverDurationS = d;
      },
      (e) => console.warn('live: POST /end failed', e),
    );
    a.serverEnds.set(sessionId, p);
    track(p);
    return p;
  };

  /**
   * destroy() exactly once per attempt, as soon as init settles (even if that is after our bounded wait gave up).
   * Releases the mic (verified on device, notes gate d). The returned promise is bounded.
   */
  const teardownSdk = (a: Attempt): Promise<void | undefined> => {
    if (!a.teardownP) {
      a.teardownP = a.initP.then((inst) => {
        if (!inst || a.destroyed) return;
        a.destroyed = true;
        try {
          inst.destroy();
        } catch (e) {
          console.warn('live: destroy failed', e);
        }
      });
      track(a.teardownP);
    }
    return bounded(a.teardownP);
  };

  const failWith = (a: Attempt, code: string) => {
    if (over(a)) return;
    a.failed = true;
    send({ type: 'ERROR', code });
    void teardownSdk(a);
    if (a.sessionId) void endOnServer(a, a.sessionId);
  };

  const end = (reason: EndReason = 'user'): Promise<void> => {
    const a = att.current;
    if (!a) return Promise.resolve();
    if (a.endP) return a.endP;
    send({ type: 'END_REQUESTED', reason, at: Date.now() });
    a.endP = (async () => {
      try {
        // In parallel and bounded: POST /end goes out right away even if destroy() is still waiting on init.
        const sid = a.sessionId;
        await bounded(Promise.all([teardownSdk(a), sid ? endOnServer(a, sid) : undefined]));
      } finally {
        const was = machineRef.current.state;
        send({ type: 'ENDED', reason, at: Date.now() });
        if (was !== 'ended' && machineRef.current.state === 'ended' && a.sessionId) optsRef.current.onEnded?.(a.sessionId);
      }
    })();
    return a.endP;
  };

  const getToken = (a: Attempt) => async (): Promise<string> => {
    if (over(a)) throw new Error('live: stale session attempt');
    if (a.tokenUsed) {
      // A reconnect after the token was used: only allowed while we never got live (e.g. a mic "Check again").
      if (machineRef.current.state !== 'connecting') throw new Error('live: session token already used');
      if (a.sessionId) await endOnServer(a, a.sessionId);
    }
    a.tokenUsed = true;
    let res: StartResult;
    try {
      res = await optsRef.current.start();
    } catch (e) {
      failWith(a, codeOf(e));
      throw e;
    }
    if (over(a) || machineRef.current.state !== 'connecting') {
      // Ended, unmounted or replaced while the session was being created: free it right away.
      void endOnServer(a, res.sessionId);
      throw new Error('live: session attempt ended while starting');
    }
    a.sessionId = res.sessionId;
    send({ type: 'SESSION', sessionId: res.sessionId });
    return res.token;
  };

  const onFlag = async (a: Attempt, msg: LiveEvent) => {
    const f = parseFlagCall(msg);
    if (!f || a.flagCalls.has(f.callId)) return;
    a.flagCalls.add(f.callId);
    send({ type: 'FLAG', category: f.category, quote: f.quote, severity: f.severity, at: Date.now() });
    haptics.light();
    // The POST keeps going in the background (the flag is still recorded); the agent gets its answer by the deadline.
    const post = a.sessionId
      ? request(`/sessions/${encodeURIComponent(a.sessionId)}/flags`, {
          method: 'POST',
          json: { category: f.category, quote: f.quote, severity: f.severity, source: 'live' },
        }).then(
          () => true,
          (e) => {
            console.warn('live: POST /flags failed', e);
            return false;
          },
        )
      : Promise.resolve(false);
    let t: ReturnType<typeof setTimeout> | undefined;
    const ok = await Promise.race([post, new Promise<boolean>((r) => (t = setTimeout(() => r(false), FLAG_OUTPUT_DEADLINE_MS)))]);
    clearTimeout(t);
    command(a, { type: 'send_function_output', data: { call_id: f.callId, output: { ok }, delay: false } });
  };

  const sendContext = (a: Attempt, sid: string, attempt = 0) => {
    request(`/sessions/${encodeURIComponent(sid)}/context`)
      .then((r) => {
        const text = (r as Partial<SessionContextView> | undefined)?.systemMessage;
        if (text) command(a, { type: 'send_message', data: { role: 'system', trigger_response: false, text } });
        const sung = songFrom(r);
        if (sung && att.current === a) setSong(sung);
      })
      .catch((e) => {
        if (attempt === 0 && !over(a)) setTimeout(() => !over(a) && sendContext(a, sid, 1), CONTEXT_RETRY_MS);
        else console.warn('live: context fetch failed', e);
      });
  };

  const callbacks = (a: Attempt): LiveCallbacks => ({
    onData: (msg) => {
      if (att.current !== a || !msg || typeof msg.event !== 'string') return;
      const cap = parseCaption(msg);
      if (cap) return send(cap);
      switch (msg.event) {
        case 'function_implicitly_called':
          void onFlag(a, msg);
          return;
        case 'avatar_connection_warning':
          send({ type: 'CONNECTION_WARNING', at: Date.now() });
          return;
        case 'session_expired':
          void end('expired');
          return;
        case 'no_credits_left':
          failWith(a, 'NO_CREDITS');
          return;
        case 'provider_connection_aborted':
          failWith(a, 'INTERNAL');
          return;
        case 'error':
          console.warn('live: napster error event', msg.data);
          return;
        default:
      }
    },
    onAvatarReady: (ready) => {
      if (!ready || att.current !== a) return;
      send({ type: 'AVATAR_READY', at: Date.now() });
      const sid = a.sessionId;
      if (a.contextSent || !sid) return;
      a.contextSent = true;
      sendContext(a, sid);
    },
    onSessionStatusChange: (s) => {
      if (att.current !== a) return;
      setSdkStatus(s);
      if (s === 'permissionBlocked' || s === 'permissionDismissed') failWith(a, 'MIC_BLOCKED');
    },
    onInactivityStatusChange: (v) => {
      if (att.current === a) send({ type: 'INACTIVE', value: v });
    },
    onDestroy: () => {
      if (att.current !== a) return;
      const ours = a.destroyed;
      a.destroyed = true;
      if (ours) return;
      // The SDK ended the session itself (server end, expiry, credits, its own idle timer).
      const st = machineRef.current.state;
      if (st === 'connecting' || st === 'live') void end('remote');
      else if (a.sessionId) void endOnServer(a, a.sessionId);
    },
    onError: (err) => {
      if (att.current !== a) return;
      const code = sdkErrorCode(err);
      if (code === 'NO_CREDITS') return failWith(a, code);
      if (code === 'SESSION_EXPIRED') return void end('expired');
      console.warn('live: napster error', err);
      // While connecting an SDK error means the call is not coming; once live, onDestroy reports a real teardown.
      if (machineRef.current.state === 'connecting') failWith(a, typeof navigator !== 'undefined' && navigator.onLine === false ? 'NETWORK' : code);
    },
  });

  const begin = () => {
    const st = machineRef.current.state;
    if (st === 'connecting' || st === 'live' || st === 'ending') return;
    const container = containerRef.current;
    send({ type: 'START' });
    setSdkStatus(null);
    setMuted(false);
    const a: Attempt = {
      initP: Promise.resolve(null),
      inst: null,
      tokenUsed: false,
      serverEnds: new Map(),
      destroyed: false,
      failed: false,
      flagCalls: new Set(),
      contextSent: false,
    };
    att.current = a;
    // The mic is settled before anything connects (task 26c round 2): no session is created and the connect
    // timeout does not run while Android's permission dialog is up. Set now, in the same render as START.
    setMicPending(true);
    a.initP = (async () => {
      let mic: MicCheck;
      try {
        mic = await (optsRef.current.micCheck ?? preflightMic)();
      } catch {
        mic = 'unavailable';
      } finally {
        if (att.current === a) setMicPending(false);
      }
      if (over(a)) return null;
      if (mic === 'denied') {
        failWith(a, 'MIC_BLOCKED');
        return null;
      }
      // Wait (bounded) for the previous attempt's destroy() and POST /end.
      await bounded(sdkIdle);
      if (over(a)) return null;
      if (!container) throw new Error('live: no avatar container');
      const sdk = optsRef.current.sdk ?? napsterSdk;
      return sdk.init(getToken(a), { mountContainer: container, ...callbacks(a) });
    })().then(
      (inst) => {
        a.inst = inst;
        return inst;
      },
      (e) => {
        console.warn('live: init failed', e);
        failWith(a, codeOf(e));
        return null;
      },
    );
  };

  const withInst = (fn: (inst: LiveInstance) => void) => {
    const inst = att.current?.inst;
    if (!inst || att.current?.destroyed) return;
    try {
      fn(inst);
    } catch (e) {
      console.warn('live: control failed', e);
    }
  };

  const mute = () => {
    withInst((i) => i.muteMic());
    setMuted(true);
  };
  const unmute = () => {
    withInst((i) => i.unmuteMic());
    setMuted(false);
  };
  const setVolume = (v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    withInst((i) => i.setAudioVolume(clamped));
    setVolumeState(clamped);
  };
  const sayOurSong = (title: string, lyrics?: string) => {
    const a = att.current;
    if (!a || machineRef.current.state !== 'live') return;
    // One line of words: blank lines and whitespace runs from the plan's text box would otherwise come back as
    // empty lines in the caption (task 26c round 2).
    const words = lyrics?.replace(/\s+/g, ' ').trim();
    const text = words ? `Now gently sing our song '${title}' using these words: ${words}` : `Now gently sing our song '${title}'.`;
    command(a, { type: 'send_message', data: { role: 'system', trigger_response: true, text } });
  };
  /** The "Still there?" card: reset the SDK's idle countdown, if it ever runs despite inactiveTimeout being off. */
  const keepAlive = () => {
    const a = att.current;
    if (!a) return;
    withInst((i) => i.keepAlive?.());
    command(a, { type: 'send_message', data: { role: 'system', trigger_response: false, text: 'The grown-up is still here and the child wants to keep chatting.' } });
    send({ type: 'INACTIVE', value: false });
  };
  const flagManually = async (category: FlagCategory, quote: string, severity: Severity) => {
    const sid = att.current?.sessionId;
    if (!sid) throw new ApiError('INVALID', 'No session yet');
    await request(`/sessions/${encodeURIComponent(sid)}/flags`, { method: 'POST', json: { category, quote, severity, source: 'manual' } });
  };

  const endRef = useRef(end);
  endRef.current = end;
  const failRef = useRef(failWith);
  failRef.current = failWith;

  // Timers: the 8-minute notice and the 10-minute cap, counted from the moment the avatar is ready.
  const { state, ctx } = machine;
  const warnMs = opts.limits?.warnMs ?? LIMITS.sessionWarnMs;
  const maxMs = opts.limits?.maxMs ?? LIMITS.sessionMaxMs;
  useEffect(() => {
    if (state !== 'live' || ctx.startedAt === undefined) return;
    const elapsed = Date.now() - ctx.startedAt;
    const warn = ctx.warnShown ? null : setTimeout(() => send({ type: 'WARN_TIME' }), Math.max(0, warnMs - elapsed));
    const cap = setTimeout(() => void endRef.current('max'), Math.max(0, maxMs - elapsed));
    return () => {
      if (warn) clearTimeout(warn);
      clearTimeout(cap);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, ctx.startedAt, ctx.warnShown, warnMs, maxMs]);

  // Connecting watchdog. Paused while the OS mic prompt is up: during our pre-flight (task 26c round 2) and if the
  // SDK itself still reports a pending prompt (it gives that its own 30 s). It starts afresh once the mic is settled.
  useEffect(() => {
    if (state !== 'connecting' || micPending || sdkStatus === 'permissionPending') return;
    const a = att.current;
    const t = setTimeout(() => {
      if (a && machineRef.current.state === 'connecting') failRef.current(a, 'CONNECT_TIMEOUT');
    }, CONNECT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [state, sdkStatus, micPending]);

  // Wobbly-connection toast; the reducer already throttles wobblyAt to once per 20 s.
  useEffect(() => {
    if (ctx.wobblyAt !== undefined) toast.info(WOBBLY_COPY);
  }, [ctx.wobblyAt]);

  // Real backgrounding ends the call (a hidden app must not keep a child's call or the mic open). The Android
  // `pause` event is not used: the RECORD_AUDIO permission dialog fires it. Never while that prompt is up.
  useAppBackground(() => {
    if (micPendingRef.current || sdkStatusRef.current === 'permissionPending') return;
    const s = machineRef.current.state;
    if (s === 'connecting' || s === 'live') void endRef.current('pause');
  });

  // Unmount ends the call. Deferred by a microtask so React StrictMode's dev-only unmount/remount does not end it.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current) void endRef.current('unmount');
      });
    };
  }, []);

  useKeepAwake(state === 'connecting' || state === 'live');

  /**
   * How long the call lasted, in seconds (P-7): the server's `durationS` from POST /end when it sent one, otherwise
   * from when the avatar went live to when the call was ended. Undefined for a call that never went live.
   */
  const callSeconds = (): number | undefined => {
    const a = att.current;
    if (a?.serverDurationS !== undefined) return a.serverDurationS;
    const { startedAt, endedAt } = machineRef.current.ctx;
    return startedAt !== undefined && endedAt !== undefined ? Math.max(0, Math.round((endedAt - startedAt) / 1000)) : undefined;
  };

  return {
    state,
    ctx,
    sdkStatus,
    micPending,
    containerRef: containerRef as RefObject<HTMLDivElement | null>,
    begin,
    end,
    mute,
    unmute,
    muted,
    volume,
    setVolume,
    song,
    sayOurSong,
    keepAlive,
    flagManually,
    callSeconds,
  };
}

export type NapsterSession = ReturnType<typeof useNapsterSession>;
