import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../../../src/core/storage/KeyValueStorage';
import { loadSettings, saveSettings, SETTINGS_KEY } from '../../../src/platform/browser/deviceSettings';

describe('device settings', () => {
  it('lets the device decide until the player picks a preset, and keeps the pick', () => {
    const storage = new MemoryStorage();
    expect(loadSettings(storage)).toEqual({ quality: 'auto' });

    expect(saveSettings(storage, { quality: 'low' })).toBe(true);

    expect(loadSettings(storage)).toEqual({ quality: 'low' });
  });

  it('falls back to the defaults on anything it cannot read, and survives storage that throws', () => {
    const storage = new MemoryStorage();
    for (const raw of ['{', 'null', '{"quality":"ultra"}', '[]']) {
      storage.setItem(SETTINGS_KEY, raw);
      expect(loadSettings(storage), raw).toEqual({ quality: 'auto' });
    }
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {},
    };
    expect(loadSettings(broken)).toEqual({ quality: 'auto' });
    expect(saveSettings(broken, { quality: 'high' })).toBe(false);
  });
});
