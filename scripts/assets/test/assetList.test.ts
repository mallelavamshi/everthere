import { describe, expect, it } from 'vitest';
import { ART_BIBLE, PALETTE } from '../artBible';
import { ASSETS } from '../assetList';

describe('ASSETS', () => {
  it('has unique keys', () => {
    const keys = ASSETS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every prompt starts with the ART_BIBLE style string', () => {
    for (const a of ASSETS) expect(a.prompt.startsWith(ART_BIBLE), a.key).toBe(true);
  });

  it('art bible uses the exact palette hex values', () => {
    for (const hex of ['#FFD23F', '#FF7A59', '#C9F2E1', '#E7DEFF', '#CFE6FF', '#2B2140', '#FFF8EC'])
      expect(ART_BIBLE).toContain(hex);
    expect(Object.keys(PALETTE)).toHaveLength(7);
  });

  it('has an asset for every spec empty state', () => {
    const keys = ASSETS.map((a) => a.key);
    for (const k of [
      'empty.noChildren',
      'empty.noSessions',
      'empty.noCaregivers',
      'empty.noAlerts',
      'empty.noStaff',
      'empty.rosterEmpty',
      'empty.offline',
      'empty.avatarsBusy',
      'empty.resting',
      'empty.error',
    ])
      expect(keys).toContain(k);
  });

  it('covers the other spec groups and the brief example keys', () => {
    const keys = ASSETS.map((a) => a.key);
    for (const k of ['brand.icon', 'onboarding.hero', 'reason.boo_boo', 'sticker.bunny', 'classroom.butterflies'])
      expect(keys).toContain(k);
    expect(keys.filter((k) => k.startsWith('reason.'))).toHaveLength(4);
    expect(keys.filter((k) => k.startsWith('sticker.'))).toHaveLength(8);
    expect(keys.filter((k) => k.startsWith('classroom.'))).toHaveLength(8);
    expect(keys.filter((k) => k.startsWith('blob.'))).toHaveLength(3);
    expect(keys.filter((k) => k.startsWith('moment.creating'))).toHaveLength(6);
  });
});
