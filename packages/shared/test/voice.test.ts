import { describe, it, expect } from 'vitest';
import { VOICES, customVoice, isCustomVoice } from '../src/domain';
import { selfConsentName } from '../src/demo';

describe('custom (cloned) voices', () => {
  it('stores a twin voice as custom:<id> and tells it apart from the stock voices', () => {
    expect(customVoice('5edcdc24-1ebc-487c-b631-4ac6275aebf1')).toBe('custom:5edcdc24-1ebc-487c-b631-4ac6275aebf1');
    expect(isCustomVoice('custom:5edcdc24-1ebc-487c-b631-4ac6275aebf1')).toBe(true);
    for (const v of VOICES) expect(isCustomVoice(v)).toBe(false);
    for (const v of ['custom:', 'custom:has space', 'Custom:x', '', null, undefined]) expect(isCustomVoice(v)).toBe(false);
  });

  it("names a self (owner's own likeness) consent truthfully", () => {
    expect(selfConsentName('Vamshi Krishna')).toBe("Vamshi Krishna (self: the account owner's own likeness and voice, consented by the owner)");
    expect(selfConsentName('Vamshi Krishna')).not.toMatch(/AI-generated/);
  });
});
