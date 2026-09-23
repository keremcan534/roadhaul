import { clamp, clamp01, finiteOr } from '../../core/math/scalar';

/**
 * What the driver asks for during one fixed step, independent of the device
 * (keyboard, touch controls, later tilt or gamepad).
 */
export interface VehicleInput {
  /** -1 = full left … +1 = full right. */
  steer: number;
  /** Gas pedal, 0..1. */
  throttle: number;
  /** Brake pedal, 0..1. Held at a standstill, it engages reverse. */
  brake: number;
}

export function createVehicleInput(): VehicleInput {
  return { steer: 0, throttle: 0, brake: 0 };
}

/**
 * Merges two devices into `out` without allocating. Steering adds up and
 * pedals take the stronger press. Every value is clamped and made finite.
 */
export function combineVehicleInputs(
  out: VehicleInput,
  a: Readonly<VehicleInput>,
  b: Readonly<VehicleInput>,
): VehicleInput {
  out.steer = clamp(finiteOr(a.steer, 0) + finiteOr(b.steer, 0), -1, 1);
  out.throttle = clamp01(Math.max(finiteOr(a.throttle, 0), finiteOr(b.throttle, 0)));
  out.brake = clamp01(Math.max(finiteOr(a.brake, 0), finiteOr(b.brake, 0)));
  return out;
}
