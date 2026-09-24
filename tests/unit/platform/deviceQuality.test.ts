import { describe, expect, it } from 'vitest';
import { chooseQuality, detectQuality, deviceHints, qualitySetting } from '../../../src/platform/browser/deviceQuality';

describe('detectQuality', () => {
  it('gives weak devices the low preset, other phones medium and desktops high', () => {
    expect(detectQuality({ cores: 4, memoryGb: 4, mobile: true })).toBe('low');
    expect(detectQuality({ cores: 8, memoryGb: 2, mobile: true })).toBe('low');
    expect(detectQuality({ cores: 8, memoryGb: 6, mobile: true })).toBe('medium');
    expect(detectQuality({ cores: 8, memoryGb: 8, mobile: false })).toBe('high');
    // Browsers that do not say: a mid-range phone, or a desktop.
    expect(detectQuality({ cores: undefined, memoryGb: undefined, mobile: true })).toBe('medium');
    expect(detectQuality({ cores: 12, memoryGb: undefined, mobile: false })).toBe('high');
  });
});

describe('chooseQuality', () => {
  it('takes ?quality= first, then the player\'s setting, then the device\'s', () => {
    expect(chooseQuality('low', 'high', 'medium')).toBe('low');
    expect(chooseQuality('ultra', 'high', 'medium')).toBe('high');
    expect(chooseQuality(null, 'auto', 'medium')).toBe('medium');
    expect(chooseQuality(null, 'low', 'high')).toBe('low');
  });
});

describe('qualitySetting', () => {
  it('is the saved setting, or the address\'s where storage forgets it', () => {
    expect(qualitySetting('low', 'high', true)).toBe('high');
    expect(qualitySetting(null, 'medium', true)).toBe('medium');
    expect(qualitySetting('low', 'auto', false)).toBe('low');
    expect(qualitySetting('auto', 'auto', false)).toBe('auto');
    expect(qualitySetting('ultra', 'auto', false)).toBe('auto');
    expect(qualitySetting(null, 'auto', false)).toBe('auto');
  });
});

describe('deviceHints', () => {
  it('reads the cores, the memory and whether it is a phone', () => {
    const android = {
      hardwareConcurrency: 8,
      deviceMemory: 4,
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) Mobile Safari/537.36',
    };
    const desktop = { hardwareConcurrency: 0, userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' };

    expect(deviceHints(android)).toEqual({ cores: 8, memoryGb: 4, mobile: true });
    expect(deviceHints(desktop)).toEqual({ cores: undefined, memoryGb: undefined, mobile: false });
  });
});
