import { isQualityChoice, QUALITY_LEVELS, type QualityChoice, type QualityLevel } from '../../data/config/GameConfig';

/** What the browser tells about the device. */
export interface DeviceHints {
  /** Logical CPU cores (navigator.hardwareConcurrency). */
  readonly cores: number | undefined;
  /** Rough memory in GB (navigator.deviceMemory, Chromium only). */
  readonly memoryGb: number | undefined;
  /** A phone or a tablet. */
  readonly mobile: boolean;
  /** The GPU's name as WebGL reports it (gpuName.ts), where it was to be had. */
  readonly gpu?: string | undefined;
}

/**
 * Phone GPUs too weak for more than the low preset, by WebGL's name for them:
 * the old Mali (4xx, T-series), the entry Mali-G (G31, G51, G52, G57, as in
 * the Galaxy A13 and the Unisoc phones), every PowerVR (the Helio G3x
 * phones) and the Adreno below the 615 and the 70x. Such phones have eight
 * cores and 4 GB, so cores and memory call them mid-range; given medium they
 * kept the GPU busy so long that Android reported the game not responding
 * (Play's ANRs, "GPU not responding", on the Infinix Smart 8, a Redmi and the
 * Galaxy A13).
 */
const WEAK_GPU = /mali-(?:\d{3}|t\d|g(?:31|51|52|57)\b)|powervr|adreno\D*(?:[1-5]\d\d|6(?:0\d|1[0-4])|70\d)\b/i;

/** True for a GPU that can carry no more than the low preset (WEAK_GPU). */
export function isWeakGpu(name: string): boolean {
  return WEAK_GPU.test(name);
}

/**
 * The weakest of them, drawing half of an entry Mali-G52 MC2's or less: the
 * small Mali-T (T6xx, T720, T820, T830: the Galaxy J7 Prime, the J and A
 * phones of 2016–2019), the Mali-G31 and G51, the single-core G52 and G57
 * (the Galaxy A13, the Unisoc phones), PowerVR's GE8 and G6 Rogues (the
 * Helio A, P, G2x and G3x) and the Adreno 3xx, 40x and 50x (Snapdragon 4xx
 * and 625). On the low preset they draw the plainer world (main.ts).
 */
const ENTRY_GPU =
  /mali-t(?:6\d\d|7[02]0|8[23]0)\b|mali-g(?:31|51)\b|mali-g5[27](?!\s*m[cp][2-9])\b|powervr rogue g(?:e8|6)\d{3}|adreno\D*(?:3\d\d|40\d|50\d)\b/i;

/** True for an entry GPU (ENTRY_GPU), the weakest phones still played on. */
export function isEntryGpu(name: string): boolean {
  return ENTRY_GPU.test(name);
}

/**
 * The graphics preset a device can carry: low with few cores, little memory
 * or a weak GPU (low-end Android), medium on other phones and tablets, high
 * on desktops. Unknown figures count as a mid-range phone's.
 */
export function detectQuality(device: DeviceHints): QualityLevel {
  if ((device.cores ?? 6) <= 4 || (device.memoryGb ?? 4) <= 3 || (device.gpu !== undefined && isWeakGpu(device.gpu))) {
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

/** The hints of the browser this runs in, with the GPU's name where it was to be had (gpuName.ts). */
export function deviceHints(navigator: NavigatorHints, gpu?: string): DeviceHints {
  const cores = navigator.hardwareConcurrency ?? 0;
  return {
    cores: cores > 0 ? cores : undefined,
    memoryGb: navigator.deviceMemory,
    mobile: navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent),
    gpu,
  };
}
