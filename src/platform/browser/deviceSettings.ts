import type { KeyValueStorage } from '../../core/storage/KeyValueStorage';
import { isQualityChoice, type QualityChoice } from '../../data/config/GameConfig';

/** Settings of this device, kept apart from the company's save: they belong to the phone, not the game. */
export interface DeviceSettings {
  readonly quality: QualityChoice;
  readonly sound: boolean;
  /** The performance display (FPS, draw calls, the preset and GPU), for testing on phones. */
  readonly stats: boolean;
}

export const SETTINGS_KEY = 'roadhaul.settings';
const DEFAULTS: DeviceSettings = Object.freeze({ quality: 'auto', sound: true, stats: false });

/** The saved settings; each one that is missing, does not read, or storage fails on, is its default. */
export function loadSettings(storage: KeyValueStorage): DeviceSettings {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SETTINGS_KEY) ?? 'null');
    if (typeof parsed !== 'object' || parsed === null) {
      return DEFAULTS;
    }
    const { quality, sound, stats } = parsed as Record<string, unknown>;
    return {
      quality: isQualityChoice(quality) ? quality : DEFAULTS.quality,
      sound: typeof sound === 'boolean' ? sound : DEFAULTS.sound,
      stats: typeof stats === 'boolean' ? stats : DEFAULTS.stats,
    };
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
