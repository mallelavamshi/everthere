import { describe, expect, it } from 'vitest';
import { flagFunctionDef, setTomlVar } from '../setupFlagTool';
import { classifyStatus, recordingCap } from '../voicePreviews';

describe('setTomlVar', () => {
  it('replaces the var', () => {
    const out = setTomlVar('[vars]\nA = "1"\nNAPSTER_FLAG_FUNCTION_ID = ""\nB = "2"\n', 'fn_9');
    expect(out).toBe('[vars]\nA = "1"\nNAPSTER_FLAG_FUNCTION_ID = "fn_9"\nB = "2"\n');
  });
  it('throws when the line is missing', () => {
    expect(() => setTomlVar('[vars]\nA = "1"\n', 'x')).toThrow(/not found/);
  });
});

describe('flag tool def', () => {
  it('uses implicit flow and the shared enums', () => {
    expect(flagFunctionDef.flow).toBe('implicit');
    expect(flagFunctionDef.data.parameters.properties.severity.enum).toEqual(['low', 'medium', 'high']);
  });
});

describe('voice previews guards', () => {
  it('MAX_RECORDINGS can lower but never raise the cap of 10', () => {
    expect(recordingCap(undefined)).toBe(10);
    expect(recordingCap('3')).toBe(3);
    expect(recordingCap('50')).toBe(10);
    expect(recordingCap('abc')).toBe(10);
  });
  it('fails fast on fail/error statuses', () => {
    expect(classifyStatus('failed')).toBe('failed');
    expect(classifyStatus('Error')).toBe('failed');
    expect(classifyStatus('pending')).toBe('wait');
    expect(classifyStatus('completed')).toBe('done');
  });
});
