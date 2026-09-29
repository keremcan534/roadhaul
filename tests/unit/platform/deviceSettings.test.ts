import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../../../src/core/storage/KeyValueStorage';
import { loadSettings, saveSettings, SETTINGS_KEY, type DeviceSettings } from '../../../src/platform/browser/deviceSettings';

const DEFAULTS: DeviceSettings = {
  language: 'auto',
  quality: 'auto',
  sound: true,
  vibration: true,
  stats: false,
  steering: 'wheel',
  tiltSensitivity: 'normal',
  controlSize: 'normal',
  camera: 'chase',
  timeFlow: 'passes',
  clockMinutes: 600,
  weather: 'auto',
  season: 'auto',
};

describe('device settings', () => {
  it('speaks the device’s language, lets it decide the graphics, plays sound, buzzes and steers with the wheel until the player picks otherwise', () => {
    const storage = new MemoryStorage();
    expect(loadSettings(storage)).toEqual(DEFAULTS);

    const picked: DeviceSettings = {
      language: 'de',
      quality: 'low',
      sound: false,
      vibration: false,
      stats: true,
      steering: 'tilt',
      tiltSensitivity: 'high',
      controlSize: 'large',
      camera: 'rear',
      timeFlow: 'stopped',
      clockMinutes: 21 * 60 + 15,
      weather: 'rain',
      season: 'winter',
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
      '{"language":"klingon","quality":"ultra","sound":"loud","vibration":"strong","stats":1,"steering":"joystick","tiltSensitivity":9,"controlSize":"huge","camera":"drone","timeFlow":"backwards","clockMinutes":1440,"weather":"snowstorm","season":"monsoon"}',
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
    storage.setItem(SETTINGS_KEY, '{"vibration":false}');
    expect(loadSettings(storage)).toEqual({ ...DEFAULTS, vibration: false });
    storage.setItem(SETTINGS_KEY, '{"language":"ru"}');
    expect(loadSettings(storage)).toEqual({ ...DEFAULTS, language: 'ru' });
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
