import type { KeyValueStorage } from '../../core/storage/KeyValueStorage';
import { MINUTES_PER_DAY } from '../../core/time/dayTime';
import {
  isCameraMode,
  isControlSize,
  isSteeringMode,
  isTiltSensitivity,
  isTimeFlow,
  type CameraMode,
  type ControlSize,
  type SteeringMode,
  type TiltSensitivity,
  type TimeFlow,
} from '../../data/config/controls';
import { isQualityChoice, type QualityChoice } from '../../data/config/GameConfig';

/** Settings of this device, kept apart from the company's save: they belong to the phone, not the game. */
export interface DeviceSettings {
  readonly quality: QualityChoice;
  readonly sound: boolean;
  /** The performance display (FPS, draw calls, the preset and GPU), for testing on phones. */
  readonly stats: boolean;
  /** How the phone steers: the on-screen wheel, tilting the phone, or left/right buttons. */
  readonly steering: SteeringMode;
  readonly tiltSensitivity: TiltSensitivity;
  /** How big the driving controls are drawn. */
  readonly controlSize: ControlSize;
  /** The driving camera last picked with the camera button. */
  readonly camera: CameraMode;
  /** How the game's clock goes: the day passes, stands still at the time picked, or keeps the phone's time. */
  readonly timeFlow: TimeFlow;
  /** The game's time of day, minutes after midnight: picked in Settings, and kept as the day goes on. */
  readonly clockMinutes: number;
}

export const SETTINGS_KEY = 'roadhaul.settings';
export const DEFAULT_SETTINGS: DeviceSettings = Object.freeze({
  quality: 'auto',
  sound: true,
  stats: false,
  steering: 'wheel',
  tiltSensitivity: 'normal',
  controlSize: 'normal',
  camera: 'chase',
  timeFlow: 'passes',
  clockMinutes: 10 * 60,
});

/** The saved settings; each one that is missing, does not read, or storage fails on, is its default. */
export function loadSettings(storage: KeyValueStorage): DeviceSettings {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SETTINGS_KEY) ?? 'null');
    if (typeof parsed !== 'object' || parsed === null) {
      return DEFAULT_SETTINGS;
    }
    const { quality, sound, stats, steering, tiltSensitivity, controlSize, camera, timeFlow, clockMinutes } = parsed as Record<
      string,
      unknown
    >;
    return {
      quality: isQualityChoice(quality) ? quality : DEFAULT_SETTINGS.quality,
      sound: typeof sound === 'boolean' ? sound : DEFAULT_SETTINGS.sound,
      stats: typeof stats === 'boolean' ? stats : DEFAULT_SETTINGS.stats,
      steering: isSteeringMode(steering) ? steering : DEFAULT_SETTINGS.steering,
      tiltSensitivity: isTiltSensitivity(tiltSensitivity) ? tiltSensitivity : DEFAULT_SETTINGS.tiltSensitivity,
      controlSize: isControlSize(controlSize) ? controlSize : DEFAULT_SETTINGS.controlSize,
      camera: isCameraMode(camera) ? camera : DEFAULT_SETTINGS.camera,
      timeFlow: isTimeFlow(timeFlow) ? timeFlow : DEFAULT_SETTINGS.timeFlow,
      clockMinutes:
        typeof clockMinutes === 'number' && clockMinutes >= 0 && clockMinutes < MINUTES_PER_DAY
          ? clockMinutes
          : DEFAULT_SETTINGS.clockMinutes,
    };
  } catch {
    return DEFAULT_SETTINGS;
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
