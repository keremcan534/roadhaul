/**
 * The driving controls a player can pick in Settings. They belong to the
 * phone (device settings), like the graphics preset.
 */

/** How the truck is steered on a phone: the on-screen wheel, turning the phone itself, or left and right buttons. */
export const STEERING_MODES = ['wheel', 'tilt', 'buttons'] as const;
export type SteeringMode = (typeof STEERING_MODES)[number];

/** How far the phone turns for full lock when steering by tilt: `low` needs the most turning. */
export const TILT_SENSITIVITIES = ['low', 'normal', 'high'] as const;
export type TiltSensitivity = (typeof TILT_SENSITIVITIES)[number];

/**
 * Tilt steering as the controls show it: `off` (another way of steering is
 * picked), `locked` (the browser wants a tap before it shares the motion
 * sensor: iOS), `waiting` (no usable reading yet: no sensor events, or the
 * phone lies flat), `on`, or `unavailable` (no motion sensor, or access refused).
 */
export type TiltStatus = 'off' | 'locked' | 'waiting' | 'on' | 'unavailable';

/** How big the on-screen driving controls are drawn. */
export const CONTROL_SIZES = ['small', 'normal', 'large'] as const;
export type ControlSize = (typeof CONTROL_SIZES)[number];

/**
 * The driving cameras (spec §31: third person, cabin, hood and rear), plus a
 * view from high above for parking. The camera button steps through them in
 * this order.
 */
export const CAMERA_MODES = ['chase', 'cabin', 'hood', 'rear', 'top'] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

export function isCameraMode(value: unknown): value is CameraMode {
  return (CAMERA_MODES as readonly unknown[]).includes(value);
}

export function isSteeringMode(value: unknown): value is SteeringMode {
  return (STEERING_MODES as readonly unknown[]).includes(value);
}

export function isTiltSensitivity(value: unknown): value is TiltSensitivity {
  return (TILT_SENSITIVITIES as readonly unknown[]).includes(value);
}

export function isControlSize(value: unknown): value is ControlSize {
  return (CONTROL_SIZES as readonly unknown[]).includes(value);
}

/**
 * How the game's clock goes (Settings): the day passes (faster than real
 * time, TimeOfDayService), stands still at the time picked, or keeps the
 * phone's own time.
 */
export const TIME_FLOWS = ['passes', 'stopped', 'device'] as const;
export type TimeFlow = (typeof TIME_FLOWS)[number];

export function isTimeFlow(value: unknown): value is TimeFlow {
  return (TIME_FLOWS as readonly unknown[]).includes(value);
}
