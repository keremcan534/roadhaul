import { isQualityChoice, QUALITY_LEVELS, type QualityChoice, type QualityLevel } from '../../data/config/GameConfig';

/** What the browser tells about the device. */
export interface DeviceHints {
  /** Logical CPU cores (navigator.hardwareConcurrency). */
  readonly cores: number | undefined;
  /** Rough memory in GB (navigator.deviceMemory, Chromium only). */
  readonly memoryGb: number | undefined;
  /** A phone or a tablet. */
  readonly mobile: boolean;
}

/**
 * The graphics preset a device can carry: low with few cores or little
 * memory (low-end Android), medium on other phones and tablets, high on
 * desktops. Unknown figures count as a mid-range phone's.
 */
export function detectQuality(device: DeviceHints): QualityLevel {
  if ((device.cores ?? 6) <= 4 || (device.memoryGb ?? 4) <= 3) {
    return 'low';
  }
  return device.mobile ? 'medium' : 'high';
}

/** The preset to play with: `?quality=` first, then the player's setting, then what the device can carry. */
export function chooseQuality(requested: string | null, setting: QualityChoice, device: QualityLevel): QualityLevel {
  if (requested !== null && (QUALITY_LEVELS as readonly string[]).includes(requested)) {
    return requested as QualityLevel;
  }
  return setting === 'auto' ? device : setting;
}

/**
 * The player's graphics setting: the saved one, or, where storage forgets
 * it (`persistent` false), the one the address carries (`?quality=`, which
 * the settings dialog sets then).
 */
export function qualitySetting(requested: string | null, saved: QualityChoice, persistent: boolean): QualityChoice {
  return !persistent && isQualityChoice(requested) ? requested : saved;
}

/** The parts of the browser's `navigator` read here; deviceMemory and userAgentData are Chromium's. */
export interface NavigatorHints {
  readonly hardwareConcurrency?: number;
  readonly deviceMemory?: number;
  readonly userAgentData?: { readonly mobile: boolean };
  readonly userAgent: string;
}

/** The hints of the browser this runs in. */
export function deviceHints(navigator: NavigatorHints): DeviceHints {
  const cores = navigator.hardwareConcurrency ?? 0;
  return {
    cores: cores > 0 ? cores : undefined,
    memoryGb: navigator.deviceMemory,
    mobile: navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent),
  };
}
