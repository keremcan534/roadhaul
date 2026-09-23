import type { KeyValueStorage } from '../../core/storage/KeyValueStorage';
import { isQualityChoice, type QualityChoice } from '../../data/config/GameConfig';

/** Settings of this device, kept apart from the company's save: they belong to the phone, not the game. */
export interface DeviceSettings {
  readonly quality: QualityChoice;
}

export const SETTINGS_KEY = 'roadhaul.settings';
const DEFAULTS: DeviceSettings = Object.freeze({ quality: 'auto' });

/** The saved settings, or the defaults when there are none, they do not read, or storage fails. */
export function loadSettings(storage: KeyValueStorage): DeviceSettings {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SETTINGS_KEY) ?? 'null');
    const quality = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>)['quality'] : undefined;
    return isQualityChoice(quality) ? { quality } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

/** Keeps `settings`; false when storage refused them. */
export function saveSettings(storage: KeyValueStorage, settings: DeviceSettings): boolean {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
