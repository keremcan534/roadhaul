import { describe, expect, it } from 'vitest';
import { chooseQuality, detectQuality, deviceHints, isWeakGpu, qualitySetting } from '../../../src/platform/browser/deviceQuality';

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

  it('gives a phone with a weak GPU the low preset, however many cores and memory it has', () => {
    // The Infinix Smart 8 (Play's ANRs): eight cores, 4 GB.
    expect(detectQuality({ cores: 8, memoryGb: 4, mobile: true, gpu: 'Mali-G57' })).toBe('low');
    expect(detectQuality({ cores: 8, memoryGb: 4, mobile: true, gpu: 'Mali-G610 MC6' })).toBe('medium');
    expect(detectQuality({ cores: 8, memoryGb: 4, mobile: true, gpu: undefined })).toBe('medium');
  });
});

describe('isWeakGpu', () => {
  it('knows the entry phone GPUs by their WebGL names', () => {
    for (const weak of [
      'Mali-G57',
      'Mali-G52 MC2',
      'Mali-G52',
      'Mali-G31 MP2',
      'Mali-T830',
      'Mali-450 MP',
      'PowerVR Rogue GE8320',
      'PowerVR B-Series BXM-8-256',
      'Adreno (TM) 610',
      'Adreno (TM) 506',
      'Adreno (TM) 702',
      'ANGLE (ARM, Mali-G57, OpenGL ES 3.2)',
    ]) {
      expect(isWeakGpu(weak), weak).toBe(true);
    }
    for (const strong of [
      'Mali-G68 MC4',
      'Mali-G710 MC10',
      'Mali-G57X',
      'Adreno (TM) 618',
      'Adreno (TM) 642L',
      'Adreno (TM) 740',
      'Apple GPU',
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Qualcomm, Adreno (TM) 8cx Gen 3, D3D11)',
    ]) {
      expect(isWeakGpu(strong), strong).toBe(false);
    }
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
    expect(deviceHints(android, 'Mali-G57').gpu).toBe('Mali-G57');
    expect(deviceHints(desktop)).toEqual({ cores: undefined, memoryGb: undefined, mobile: false });
  });
});
