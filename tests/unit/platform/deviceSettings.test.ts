import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../../../src/core/storage/KeyValueStorage';
import { loadSettings, saveSettings, SETTINGS_KEY, type DeviceSettings } from '../../../src/platform/browser/deviceSettings';

const DEFAULTS: DeviceSettings = {
  quality: 'auto',
  sound: true,
  stats: false,
  steering: 'wheel',
  tiltSensitivity: 'normal',
  controlSize: 'normal',
  camera: 'chase',
};

describe('device settings', () => {
  it('lets the device decide, plays sound and steers with the wheel until the player picks otherwise', () => {
    const storage = new MemoryStorage();
    expect(loadSettings(storage)).toEqual(DEFAULTS);

    const picked: DeviceSettings = {
      quality: 'low',
      sound: false,
      stats: true,
      steering: 'tilt',
      tiltSensitivity: 'high',
      controlSize: 'large',
      camera: 'rear',
    };
    expect(saveSettings(storage, picked)).toBe(true);

    expect(loadSettings(storage)).toEqual(picked);
  });

  it('falls back to the default of each setting it cannot read', () => {
    const storage = new MemoryStorage();
    for (const raw of [
      '{',
      'null',
      '[]',
      '{"quality":"ultra","sound":"loud","stats":1,"steering":"joystick","tiltSensitivity":9,"controlSize":"huge","camera":"drone"}',
    ]) {
      storage.setItem(SETTINGS_KEY, raw);
      expect(loadSettings(storage), raw).toEqual(DEFAULTS);
    }
    // Settings saved before the later ones existed keep what they had.
    storage.setItem(SETTINGS_KEY, '{"quality":"medium"}');
    expect(loadSettings(storage)).toEqual({ ...DEFAULTS, quality: 'medium' });
    storage.setItem(SETTINGS_KEY, '{"quality":"ultra","sound":false,"stats":true}');
    expect(loadSettings(storage)).toEqual({ ...DEFAULTS, sound: false, stats: true });
    storage.setItem(SETTINGS_KEY, '{"steering":"buttons","controlSize":"small"}');
    expect(loadSettings(storage)).toEqual({ ...DEFAULTS, steering: 'buttons', controlSize: 'small' });
  });

  it('survives storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {},
    };
    expect(loadSettings(broken)).toEqual(DEFAULTS);
    expect(saveSettings(broken, { ...DEFAULTS, quality: 'high' })).toBe(false);
  });
});
