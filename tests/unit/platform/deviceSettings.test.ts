import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../../../src/core/storage/KeyValueStorage';
import { loadSettings, saveSettings, SETTINGS_KEY } from '../../../src/platform/browser/deviceSettings';

describe('device settings', () => {
  it('lets the device decide and plays sound until the player picks otherwise, and keeps the picks', () => {
    const storage = new MemoryStorage();
    expect(loadSettings(storage)).toEqual({ quality: 'auto', sound: true });

    expect(saveSettings(storage, { quality: 'low', sound: false })).toBe(true);

    expect(loadSettings(storage)).toEqual({ quality: 'low', sound: false });
  });

  it('falls back to the default of each setting it cannot read', () => {
    const storage = new MemoryStorage();
    for (const raw of ['{', 'null', '[]', '{"quality":"ultra","sound":"loud"}']) {
      storage.setItem(SETTINGS_KEY, raw);
      expect(loadSettings(storage), raw).toEqual({ quality: 'auto', sound: true });
    }
    // Settings saved before there was a sound setting keep their graphics.
    storage.setItem(SETTINGS_KEY, '{"quality":"medium"}');
    expect(loadSettings(storage)).toEqual({ quality: 'medium', sound: true });
    storage.setItem(SETTINGS_KEY, '{"quality":"ultra","sound":false}');
    expect(loadSettings(storage)).toEqual({ quality: 'auto', sound: false });
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
    expect(loadSettings(broken)).toEqual({ quality: 'auto', sound: true });
    expect(saveSettings(broken, { quality: 'high', sound: true })).toBe(false);
  });
});
