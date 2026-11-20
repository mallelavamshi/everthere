import { describe, expect, it } from 'vitest';
import {
  BANNER_MS,
  WOBBLY_THROTTLE_MS,
  initialMachine,
  sessionMachine,
  type Machine,
  type SessionEvent,
} from '../src/live/sessionMachine';

const run = (events: SessionEvent[], from: Machine = initialMachine): Machine => events.reduce(sessionMachine, from);
const live = (at = 1000) => run([{ type: 'START' }, { type: 'SESSION', sessionId: 's1' }, { type: 'AVATAR_READY', at }]);

describe('sessionMachine', () => {
  it('START moves idle -> connecting', () => {
    expect(run([{ type: 'START' }]).state).toBe('connecting');
  });

  it('START in connecting is ignored (same object back)', () => {
    const connecting = run([{ type: 'START' }, { type: 'SESSION', sessionId: 's1' }]);
    expect(sessionMachine(connecting, { type: 'START' })).toBe(connecting);
  });

  it('START from ended or failed begins a fresh attempt with a clean context', () => {
    const ended = run([{ type: 'END_REQUESTED', reason: 'user' }, { type: 'ENDED' }], live());
    const again = sessionMachine(ended, { type: 'START' });
    expect(again.state).toBe('connecting');
    expect(again.ctx.sessionId).toBeUndefined();
    expect(again.ctx.captions).toEqual([]);
    const failed = run([{ type: 'START' }, { type: 'ERROR', code: 'AVATARS_BUSY' }]);
    expect(sessionMachine(failed, { type: 'START' }).ctx.error).toBeUndefined();
  });

  it('AVATAR_READY -> live with startedAt set', () => {
    const m = live(4242);
    expect(m.state).toBe('live');
    expect(m.ctx.startedAt).toBe(4242);
    expect(m.ctx.sessionId).toBe('s1');
  });

  it('AVATAR_READY outside connecting is ignored', () => {
    expect(sessionMachine(initialMachine, { type: 'AVATAR_READY', at: 1 })).toBe(initialMachine);
    const m = live(10);
    expect(sessionMachine(m, { type: 'AVATAR_READY', at: 99 }).ctx.startedAt).toBe(10);
  });

  it('CAPTION keeps only the last 2', () => {
    const m = run(
      [
        { type: 'CAPTION', id: 'a', role: 'avatar', text: 'one', mode: 'replace' },
        { type: 'CAPTION', id: 'b', role: 'child', text: 'two', mode: 'replace' },
        { type: 'CAPTION', id: 'c', role: 'avatar', text: 'three', mode: 'replace' },
      ],
      live(),
    );
    expect(m.ctx.captions.map((c) => c.text)).toEqual(['two', 'three']);
  });

  it('CAPTION appends deltas to the same id and ignores late deltas for a retired id', () => {
    const m = run(
      [
        { type: 'CAPTION', id: 'a', role: 'avatar', text: 'Hel', mode: 'append' },
        { type: 'CAPTION', id: 'a', role: 'avatar', text: 'lo', mode: 'append' },
        { type: 'CAPTION', id: 'b', role: 'child', text: 'hi', mode: 'replace' },
        { type: 'CAPTION', id: 'c', role: 'avatar', text: 'yo', mode: 'replace' },
        { type: 'CAPTION', id: 'a', role: 'avatar', text: ' late', mode: 'append' },
      ],
      live(),
    );
    expect(m.ctx.captions).toEqual([
      { id: 'b', role: 'child', text: 'hi' },
      { id: 'c', role: 'avatar', text: 'yo' },
    ]);
  });

  it('CAPTION replace (completed) overwrites the accumulated deltas', () => {
    const m = run(
      [
        { type: 'CAPTION', id: 'a', role: 'avatar', text: 'Hel', mode: 'append' },
        { type: 'CAPTION', id: 'a', role: 'avatar', text: 'Hello there!', mode: 'replace' },
      ],
      live(),
    );
    expect(m.ctx.captions).toEqual([{ id: 'a', role: 'avatar', text: 'Hello there!' }]);
  });

  it('CAPTION never leaves an empty bubble: whitespace-only lines are dropped, and a line completed empty goes (P-5)', () => {
    const m = run(
      [
        { type: 'CAPTION', id: 'u1', role: 'child', text: '', mode: 'replace' },
        { type: 'CAPTION', id: 'u2', role: 'child', text: ' \n ', mode: 'replace' },
        { type: 'CAPTION', id: 'a', role: 'avatar', text: 'Hello', mode: 'append' },
        { type: 'CAPTION', id: 'u3', role: 'child', text: 'mm', mode: 'append' },
        { type: 'CAPTION', id: 'u3', role: 'child', text: '  ', mode: 'replace' },
      ],
      live(),
    );
    expect(m.ctx.captions).toEqual([{ id: 'a', role: 'avatar', text: 'Hello' }]);
    expect(m.ctx.announce).toBeUndefined();
    // A real completion for that turn can still show up afterwards.
    const later = sessionMachine(m, { type: 'CAPTION', id: 'u3', role: 'child', text: 'Mommy', mode: 'replace' });
    expect(later.ctx.captions.map((c) => c.text)).toEqual(['Hello', 'Mommy']);
  });

  it('CAPTION is ignored when idle or ended, but accepted while connecting (opening line)', () => {
    const e = { type: 'CAPTION', id: 'a', role: 'avatar', text: 'Hel', mode: 'append' } as const;
    expect(sessionMachine(initialMachine, e)).toBe(initialMachine);
    const ended = run([{ type: 'END_REQUESTED', reason: 'user' }, { type: 'ENDED' }], live());
    expect(sessionMachine(ended, e)).toBe(ended);
    const connecting = run([{ type: 'START' }, e, { type: 'CAPTION', id: 'a', role: 'avatar', text: 'lo', mode: 'append' }, { type: 'AVATAR_READY', at: 5 }]);
    expect(connecting.ctx.captions).toEqual([{ id: 'a', role: 'avatar', text: 'Hello' }]);
  });

  it('announce holds only completed lines, never partial deltas', () => {
    const a = run([{ type: 'CAPTION', id: 'a', role: 'avatar', text: 'Hel', mode: 'append' }], live());
    expect(a.ctx.announce).toBeUndefined();
    const b = sessionMachine(a, { type: 'CAPTION', id: 'a', role: 'avatar', text: 'Hello there', mode: 'replace' });
    expect(b.ctx.announce).toEqual({ id: 'a', role: 'avatar', text: 'Hello there' });
    // A repeated completed frame (user created + completed) changes nothing.
    expect(sessionMachine(b, { type: 'CAPTION', id: 'a', role: 'avatar', text: 'Hello there', mode: 'replace' })).toBe(b);
  });

  it('FLAG appends and sets bannerUntil', () => {
    const m = run(
      [
        { type: 'FLAG', category: 'injury', quote: 'I fell and hurt my knee', severity: 'low', at: 5000 },
        { type: 'FLAG', category: 'illness', quote: 'my tummy', severity: 'medium', at: 9000 },
      ],
      live(),
    );
    expect(m.ctx.flags).toHaveLength(2);
    expect(m.ctx.flags[0]).toMatchObject({ category: 'injury', quote: 'I fell and hurt my knee', severity: 'low' });
    expect(m.ctx.bannerUntil).toBe(9000 + BANNER_MS);
  });

  it('WARN_TIME sets warnShown while live', () => {
    expect(sessionMachine(live(), { type: 'WARN_TIME' }).ctx.warnShown).toBe(true);
  });

  it('CONNECTION_WARNING sets wobbly at most once per 20 s', () => {
    const a = sessionMachine(live(), { type: 'CONNECTION_WARNING', at: 1000 });
    expect(a.ctx.wobbly).toBe(true);
    expect(a.ctx.wobblyAt).toBe(1000);
    const b = sessionMachine(a, { type: 'CONNECTION_WARNING', at: 1000 + WOBBLY_THROTTLE_MS - 1 });
    expect(b).toBe(a);
    const c = sessionMachine(b, { type: 'CONNECTION_WARNING', at: 1000 + WOBBLY_THROTTLE_MS });
    expect(c.ctx.wobblyAt).toBe(1000 + WOBBLY_THROTTLE_MS);
  });

  it('END_REQUESTED from live -> ending, and from idle is ignored', () => {
    expect(sessionMachine(live(), { type: 'END_REQUESTED', reason: 'user' }).state).toBe('ending');
    expect(sessionMachine(initialMachine, { type: 'END_REQUESTED', reason: 'user' })).toBe(initialMachine);
  });

  it('END_REQUESTED from connecting -> ending (End tapped while connecting)', () => {
    expect(sessionMachine(run([{ type: 'START' }]), { type: 'END_REQUESTED', reason: 'user' }).state).toBe('ending');
  });

  it('ENDED -> ended, keeping the end reason from END_REQUESTED', () => {
    const m = run([{ type: 'END_REQUESTED', reason: 'max' }, { type: 'ENDED' }], live());
    expect(m.state).toBe('ended');
    expect(m.ctx.endReason).toBe('max');
  });

  it('ENDED straight from live (remote end) records the given reason', () => {
    const m = sessionMachine(live(), { type: 'ENDED', reason: 'remote' });
    expect(m.state).toBe('ended');
    expect(m.ctx.endReason).toBe('remote');
  });

  it('ERROR{AVATARS_BUSY} -> failed with the code', () => {
    const m = run([{ type: 'START' }, { type: 'ERROR', code: 'AVATARS_BUSY' }]);
    expect(m.state).toBe('failed');
    expect(m.ctx.error).toBe('AVATARS_BUSY');
  });

  it('ERROR after the session ended, and ENDED after a failure, are ignored', () => {
    const ended = run([{ type: 'END_REQUESTED', reason: 'user' }, { type: 'ENDED' }], live());
    expect(sessionMachine(ended, { type: 'ERROR', code: 'INTERNAL' })).toBe(ended);
    const failed = run([{ type: 'START' }, { type: 'ERROR', code: 'RESTING' }]);
    expect(sessionMachine(failed, { type: 'ENDED' })).toBe(failed);
    expect(sessionMachine(failed, { type: 'ERROR', code: 'NETWORK' }).ctx.error).toBe('RESTING');
  });

  it('INACTIVE tracks the SDK inactivity flag while live', () => {
    const m = sessionMachine(live(), { type: 'INACTIVE', value: true });
    expect(m.ctx.inactive).toBe(true);
    expect(sessionMachine(m, { type: 'INACTIVE', value: false }).ctx.inactive).toBe(false);
  });
});
