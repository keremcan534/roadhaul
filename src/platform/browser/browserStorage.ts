import { MemoryStorage, type KeyValueStorage } from '../../core/storage/KeyValueStorage';

/**
 * The browser's localStorage when it works, otherwise an in-memory stand-in:
 * some private windows and embedded views throw on any access. The game then
 * still runs; it just cannot keep the save after the page closes.
 */
export function browserStorage(window: Window): { storage: KeyValueStorage; persistent: boolean } {
  try {
    const storage = window.localStorage;
    const probe = 'roadhaul.probe';
    storage.setItem(probe, probe);
    storage.removeItem(probe);
    return { storage, persistent: true };
  } catch {
    return { storage: new MemoryStorage(), persistent: false };
  }
}
