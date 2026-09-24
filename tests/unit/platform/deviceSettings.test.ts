import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../../../src/core/storage/KeyValueStorage';
import { loadSettings, saveSettings, SETTINGS_KEY } from '../../../src/platform/browser/deviceSettings';

const DEFAULTS = { quality: 'auto', sound: true, stats: false };

describe('device settings', () => {
  it('lets the device decide, plays sound and hides the performance display until the player picks otherwise', () => {
    const storage = new MemoryStorage();
    expect(loadSettings(storage)).toEqual(DEFAULTS);

    expect(saveSettings(storage, { quality: 'low', sound: false, stats: true })).toBe(true);

    expect(loadSettings(storage)).toEqual({ quality: 'low', sound: false, stats: true });
  });

  it('falls back to the default of each setting it cannot read', () => {
    const storage = new MemoryStorage();
    for (const raw of ['{', 'null', '[]', '{"quality":"ultra","sound":"loud","stats":1}']) {
      storage.setItem(SETTINGS_KEY, raw);
      expect(loadSettings(storage), raw).toEqual(DEFAULTS);
    }
    // Settings saved before the later ones existed keep what they had.
    storage.setItem(SETTINGS_KEY, '{"quality":"medium"}');
    expect(loadSettings(storage)).toEqual({ ...DEFAULTS, quality: 'medium' });
    storage.setItem(SETTINGS_KEY, '{"quality":"ultra","sound":false}');
    expect(loadSettings(storage)).toEqual({ ...DEFAULTS, sound: false });
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
    expect(saveSettings(broken, { quality: 'high', sound: true, stats: false })).toBe(false);
  });
});
