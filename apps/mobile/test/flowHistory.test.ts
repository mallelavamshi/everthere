import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindFlowAvatar, clearFlow, leaveFlow, markFlowStart } from '../src/lib/flowHistory';

// Device test M-8: after approving, Android back walked into the stale avatar setup/test screens. Leaving the flow
// now rewinds the browser history to just before the flow started, then replaces that entry with home.

let idx = 0;
const go = vi.fn();
beforeEach(() => {
  idx = 0;
  go.mockReset();
  sessionStorage.clear();
  vi.spyOn(window.history, 'state', 'get').mockImplementation(() => ({ idx }));
  vi.spyOn(window.history, 'go').mockImplementation(go);
});
afterEach(() => vi.restoreAllMocks());

describe('flowHistory', () => {
  it('rewinds every entry of the flow, then replaces with home once the pop lands', () => {
    const navigate = vi.fn();
    idx = 3; // /parent is 2, setup/photo is 3
    markFlowStart();
    bindFlowAvatar('av1');
    idx = 6; // photo -> voice -> consent/creating/test -> live -> test (after)
    leaveFlow('av1', navigate, '/parent');
    expect(go).toHaveBeenCalledWith(-4);
    expect(navigate).not.toHaveBeenCalled();
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(navigate).toHaveBeenCalledWith('/parent', { replace: true });
    // One-shot.
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('falls back to a plain replace when the record is for another avatar, missing, or would rewind past the start', () => {
    const navigate = vi.fn();
    idx = 3;
    markFlowStart();
    bindFlowAvatar('other');
    idx = 5;
    leaveFlow('av1', navigate, '/parent');
    expect(go).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenLastCalledWith('/parent', { replace: true });

    leaveFlow('av1', navigate, '/parent'); // record cleared by the previous call
    expect(go).not.toHaveBeenCalled();

    idx = 0; // the flow is the very first entry: nothing before it to land on
    markFlowStart();
    bindFlowAvatar('av1');
    idx = 2;
    leaveFlow('av1', navigate, '/parent');
    expect(go).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(3);
  });

  it('an unbound (abandoned) or cleared flow is never rewound', () => {
    const navigate = vi.fn();
    idx = 3;
    markFlowStart();
    idx = 5;
    leaveFlow('av1', navigate, '/parent');
    expect(go).not.toHaveBeenCalled();
    markFlowStart();
    bindFlowAvatar('av1');
    clearFlow();
    leaveFlow('av1', navigate, '/parent');
    expect(go).not.toHaveBeenCalled();
  });
});
