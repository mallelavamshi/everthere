import { describe, expect, it } from 'vitest';
import { initialMachine, sessionMachine, type Machine } from '../src/live/sessionMachine';
import { parseCaption, parseFlagCall, sdkErrorCode } from '../src/live/events';
import { errorView } from '../src/live/errorViews';
import { napsterConfig } from '../src/live/sdk';

// Real frames from docs/notes/napster-events.md (timestamps trimmed).
const frames = {
  session: { event: 'message_received', data: { message: { action: 'created', type: 'session', session: { id: 'sess_Ellm9qvhZOFS7okbbC3I0' }, is_forced: false } } },
  respCreated: { event: 'message_received', data: { message: { action: 'created', role: 'assistant', response_id: 'resp_A', is_forced: false } } },
  itemCreated: { event: 'message_received', data: { message: { action: 'created', type: 'message', role: 'assistant', response_id: 'resp_A', item_id: 'item_A', is_forced: false } } },
  delta1: { event: 'message_received', data: { message: { action: 'delta', type: 'message', role: 'assistant', response_id: 'resp_A', item_id: 'item_A', content: 'Hello', content_index: 0, emotion: 'neutral' } } },
  delta2: { event: 'message_received', data: { message: { action: 'delta', type: 'message', role: 'assistant', response_id: 'resp_A', item_id: 'item_A', content: '! How are', content_index: 0, emotion: 'neutral' } } },
  completed: { event: 'message_received', data: { message: { action: 'completed', type: 'message', role: 'assistant', response_id: 'resp_A', item_id: 'item_A', content: 'Hello! How are you feeling today?', emotion: 'neutral' } } },
  respCompleted: { event: 'message_received', data: { message: { action: 'completed', role: 'assistant', response_id: 'resp_A', usage: { input_tokens: 1422, output_tokens: 76, total_tokens: 1498 } } } },
  userCreated: { event: 'message_received', data: { message: { action: 'created', type: 'message', role: 'user', item_id: 'item_U', content: 'I fell and hurt my knee', previous_item_id: 'item_A' } } },
  userCompleted: { event: 'message_received', data: { message: { action: 'completed', type: 'message', role: 'user', item_id: 'item_U', content: 'I fell and hurt my knee', previous_item_id: 'item_A' } } },
  fnCompleted: {
    event: 'message_received',
    data: { message: { action: 'completed', type: 'function_call', response_id: 'resp_F', item_id: 'item_F', content: '{"category":"injury"}', call_id: 'call_nvLJ7jPEYa5DDMbQ', tool: 'flag_concern' } },
  },
  implicit: {
    event: 'function_implicitly_called',
    data: {
      item_id: 'item_EllmQTXWcUKSeFtbqHkle',
      call_id: 'call_nvLJ7jPEYa5DDMbQ',
      name: 'flag_concern',
      arguments: { category: 'injury', quote: 'I fell and hurt my knee', severity: 'low' },
      metadata: { tags: null, external_client_id: 'spike_x', external_client_profile: null },
    },
  },
  talk: { event: 'talk_state_changed', data: { talk_id: 'item_A', state: 'started', sentence_index: null, is_forced: false } },
};

describe('parseCaption (real message_received shapes)', () => {
  it('skips session, response-level and function_call frames, and frames without content', () => {
    for (const f of [frames.session, frames.respCreated, frames.itemCreated, frames.respCompleted, frames.fnCompleted, frames.talk, frames.implicit]) {
      expect(parseCaption(f)).toBeNull();
    }
  });

  it('maps assistant deltas to appends and completed to a replace, keyed by item_id', () => {
    expect(parseCaption(frames.delta1)).toEqual({ type: 'CAPTION', id: 'item_A', role: 'avatar', text: 'Hello', mode: 'append' });
    expect(parseCaption(frames.completed)).toEqual({ type: 'CAPTION', id: 'item_A', role: 'avatar', text: 'Hello! How are you feeling today?', mode: 'replace' });
  });

  it('maps user turns to child captions', () => {
    expect(parseCaption(frames.userCreated)).toEqual({ type: 'CAPTION', id: 'item_U', role: 'child', text: 'I fell and hurt my knee', mode: 'replace' });
  });

  it('falls back to response_id when a frame has no item_id', () => {
    const f = { event: 'message_received', data: { message: { action: 'delta', type: 'message', role: 'assistant', response_id: 'resp_Z', content: 'Hi' } } };
    expect(parseCaption(f)?.id).toBe('resp_Z');
  });

  it('a full replay through the reducer merges deltas into one bubble and keeps the last 2', () => {
    let m: Machine = [{ type: 'START' } as const, { type: 'AVATAR_READY', at: 1 } as const].reduce(sessionMachine, initialMachine);
    for (const f of [frames.session, frames.respCreated, frames.itemCreated, frames.delta1, frames.delta2]) {
      const e = parseCaption(f);
      if (e) m = sessionMachine(m, e);
    }
    expect(m.ctx.captions).toEqual([{ id: 'item_A', role: 'avatar', text: 'Hello! How are' }]);
    for (const f of [frames.completed, frames.respCompleted, frames.userCreated, frames.userCompleted]) {
      const e = parseCaption(f);
      if (e) m = sessionMachine(m, e);
    }
    expect(m.ctx.captions).toEqual([
      { id: 'item_A', role: 'avatar', text: 'Hello! How are you feeling today?' },
      { id: 'item_U', role: 'child', text: 'I fell and hurt my knee' },
    ]);
  });
});

describe('parseFlagCall', () => {
  it('reads name, call_id and object arguments from function_implicitly_called', () => {
    expect(parseFlagCall(frames.implicit)).toEqual({ callId: 'call_nvLJ7jPEYa5DDMbQ', category: 'injury', quote: 'I fell and hurt my knee', severity: 'low' });
  });

  it('accepts arguments as a JSON string (as in the transcript frame)', () => {
    const f = { event: 'function_implicitly_called', data: { call_id: 'c1', name: 'flag_concern', arguments: '{  \n  "category": "illness", \n  "quote": "my tummy hurts",  \n  "severity": "medium" \n} \n' } };
    expect(parseFlagCall(f)).toEqual({ callId: 'c1', category: 'illness', quote: 'my tummy hurts', severity: 'medium' });
  });

  it('coerces unknown categories/severities and fills an empty quote so the API accepts it', () => {
    const f = { event: 'function_implicitly_called', data: { call_id: 'c2', name: 'flag_concern', arguments: { category: 'weird', severity: 'urgent', quote: '  ' } } };
    expect(parseFlagCall(f)).toEqual({ callId: 'c2', category: 'other', quote: '(no words captured)', severity: 'medium' });
  });

  it('ignores other functions, other events and calls without a call_id', () => {
    expect(parseFlagCall({ event: 'function_implicitly_called', data: { call_id: 'c', name: 'something_else', arguments: {} } })).toBeNull();
    expect(parseFlagCall(frames.fnCompleted)).toBeNull();
    expect(parseFlagCall({ event: 'function_implicitly_called', data: { name: 'flag_concern', arguments: {} } })).toBeNull();
  });
});

describe('sdkErrorCode', () => {
  it('maps the SDK credit and expiry reasons', () => {
    expect(sdkErrorCode({ code: 'CONNECTION_ERROR', context: { reason: 'no_credits_left' } })).toBe('NO_CREDITS');
    expect(sdkErrorCode({ code: 'CONNECTION_ERROR', context: { reason: 'session_expired' } })).toBe('SESSION_EXPIRED');
    expect(sdkErrorCode({ code: 'MEDIA_ERROR' })).toBe('INTERNAL');
    expect(sdkErrorCode(null)).toBe('INTERNAL');
  });
});

describe('errorView (friendly full-screen states)', () => {
  const who = { mode: 'child' as const, childName: 'Mia', parentTitle: 'Mom' };
  it('AVATARS_BUSY: busy hugging, with Try again', () => {
    const v = errorView('AVATARS_BUSY', who);
    expect(v.asset).toBe('empty.avatarsBusy');
    expect(v.title).toMatch(/All our avatars are busy hugging/);
    expect(v.retry).toBe(true);
  });
  it('RESTING uses the resting illustration', () => {
    expect(errorView('RESTING', who).asset).toBe('empty.resting');
  });
  it('SESSION_ACTIVE names the child, with no retry', () => {
    const v = errorView('SESSION_ACTIVE', who);
    expect(v.title).toBe('Mia already has a comfort call going');
    expect(v.retry).toBe(false);
  });
  it('NETWORK uses the offline illustration', () => {
    expect(errorView('NETWORK', who).asset).toBe('empty.offline');
  });
  it('MIC_BLOCKED explains how to allow the microphone', () => {
    const v = errorView('MIC_BLOCKED', who);
    expect(v.body).toMatch(/Settings/);
    expect(v.body).toMatch(/Microphone/);
    expect(v.retry).toBe(true);
  });
  it('MIC_BLOCKED in a browser points at the address bar, not phone settings', () => {
    const v = errorView('MIC_BLOCKED', { ...who, web: true });
    expect(v.body).toMatch(/address bar/);
    expect(v.body).not.toMatch(/phone's Settings/);
    expect(v.retry).toBe(true);
  });
  it('CONNECT_TIMEOUT is a network-style state with Try again', () => {
    const v = errorView('CONNECT_TIMEOUT', who);
    expect(v.asset).toBe('empty.offline');
    expect(v.retry).toBe(true);
  });
  it('NO_CREDITS is its own friendly state', () => {
    expect(errorView('NO_CREDITS', who).title).toMatch(/minutes/i);
  });
  it('INVALID gets its own friendly state (not the generic tangle), naming the child and parent', () => {
    const v = errorView('INVALID', who);
    expect(v.title).not.toMatch(/didn't connect/);
    expect(v.title).toBe("Mia's call can't start just yet");
    expect(v.body).toMatch(/Mom/);
    expect(v.body).not.toMatch(/tangled/);
    expect(v.asset).toBe('empty.error');
    expect(v.retry).toBe(true);
    const t = errorView('INVALID', { mode: 'test' });
    expect(t.title).toBe("This test call can't start just yet");
    expect(t.retry).toBe(true);
  });
  it('anything else falls back to the generic tangle with retry', () => {
    const v = errorView('INTERNAL', who);
    expect(v.asset).toBe('empty.error');
    expect(v.retry).toBe(true);
  });
});

describe('napsterConfig', () => {
  it('mounts inline, never auto-ends before our cap, and enables nothing that opens the camera', () => {
    const el = document.createElement('div');
    const cfg = napsterConfig(el, {});
    expect(cfg.layout).toEqual({ type: 'inline', mountContainer: el });
    expect(cfg.features?.inactiveTimeout?.enabled).toBe(false);
    expect(cfg.features?.faceTracking?.enabled).toBe(false);
    expect(cfg.features?.screenShare?.enabled).toBe(false);
    expect(cfg.features?.controls?.enabled).toBe(false);
  });
});

describe('SDK polish (device test M-2, M-3)', () => {
  it('global.css visually hides the SDK announcer ("Avatar is ready") inside our avatar host, keeping it for screen readers', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const css = readFileSync(resolve(import.meta.dirname, '../src/theme/global.css'), 'utf8');
    const rule = /\.et-avatar-host\s+\.np_companion-announcer[^{]*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/clip:\s*rect\(0,?\s*0,?\s*0,?\s*0\)/);
    expect(rule![1]).toMatch(/position:\s*absolute/);
    expect(rule![1]).not.toMatch(/display:\s*none/);
  });

  it('ensureMediaSessionShim defines MediaMetadata and navigator.mediaSession only when the WebView lacks them', async () => {
    const { ensureMediaSessionShim } = await import('../src/live/sdk');
    const g = globalThis as { MediaMetadata?: unknown };
    const hadMM = 'MediaMetadata' in g;
    const savedMM = g.MediaMetadata;
    const savedMS = Object.getOwnPropertyDescriptor(navigator, 'mediaSession');
    try {
      delete g.MediaMetadata;
      Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: undefined });
      ensureMediaSessionShim();
      const MM = g.MediaMetadata as new (init: { title: string }) => { title: string };
      const m = new MM({ title: 'Napster Companion' });
      expect(m.title).toBe('Napster Companion');
      const ms = navigator.mediaSession as unknown as { metadata: unknown; setActionHandler: (a: string, h: null) => void };
      expect(() => (ms.metadata = m)).not.toThrow();
      expect(() => ms.setActionHandler('play', null)).not.toThrow();
      // Existing implementations are left alone.
      class Real {}
      g.MediaMetadata = Real;
      ensureMediaSessionShim();
      expect(g.MediaMetadata).toBe(Real);
    } finally {
      if (hadMM) g.MediaMetadata = savedMM;
      else delete g.MediaMetadata;
      if (savedMS) Object.defineProperty(navigator, 'mediaSession', savedMS);
      else delete (navigator as unknown as Record<string, unknown>).mediaSession;
    }
  });
});
