import { clamp, clamp01, finiteOr } from '../../core/math/scalar';

/**
 * The gear lever. With `auto` (the keyboard's way) the brake held at a
 * standstill engages reverse, and in reverse the brake pedal drives
 * backwards. `drive` and `reverse` (the touch controls' D/R button) pick the
 * direction instead: the gas pedal drives that way, and the brake only brakes.
 */
export const GEAR_LEVERS = ['auto', 'drive', 'reverse'] as const;
export type GearLever = (typeof GEAR_LEVERS)[number];

/**
 * What the driver asks for during one fixed step, independent of the device
 * (keyboard, touch controls, tilt).
 */
export interface VehicleInput {
  /** -1 = full left … +1 = full right. */
  steer: number;
  /** Gas pedal, 0..1. */
  throttle: number;
  /** Brake pedal, 0..1. With the lever on `auto`, held at a standstill it engages reverse. */
  brake: number;
  /** The gear lever; absent counts as `auto`. */
  lever?: GearLever;
}

export function createVehicleInput(): VehicleInput {
  return { steer: 0, throttle: 0, brake: 0, lever: 'auto' };
}

/**
 * Merges two devices into `out` without allocating. Steering adds up and
 * pedals take the stronger press. Every value is clamped and made finite.
 * The lever is the one of the device whose pedals are pressed; with both or
 * neither pressed, a lever that is set (not `auto`) wins over one that is not.
 */
export function combineVehicleInputs(
  out: VehicleInput,
  a: Readonly<VehicleInput>,
  b: Readonly<VehicleInput>,
): VehicleInput {
  out.steer = clamp(finiteOr(a.steer, 0) + finiteOr(b.steer, 0), -1, 1);
  out.throttle = clamp01(Math.max(finiteOr(a.throttle, 0), finiteOr(b.throttle, 0)));
  out.brake = clamp01(Math.max(finiteOr(a.brake, 0), finiteOr(b.brake, 0)));
  out.lever = combinedLever(a, b);
  return out;
}

function combinedLever(a: Readonly<VehicleInput>, b: Readonly<VehicleInput>): GearLever {
  const leverA = leverOf(a);
  const leverB = leverOf(b);
  if (leverA === leverB) {
    return leverA;
  }
  const pressingA = pressing(a);
  const pressingB = pressing(b);
  if (pressingA !== pressingB) {
    return pressingA ? leverA : leverB;
  }
  return leverA !== 'auto' ? leverA : leverB;
}

function leverOf(input: Readonly<VehicleInput>): GearLever {
  const lever = input.lever;
  return lever === 'drive' || lever === 'reverse' ? lever : 'auto';
}

function pressing(input: Readonly<VehicleInput>): boolean {
  return finiteOr(input.throttle, 0) > 0 || finiteOr(input.brake, 0) > 0;
}

/**
 * The pedal that drives the truck in its current direction (`reversing`),
 * as VehicleDynamics reads the two pedals: with the lever on `auto` the
 * brake pedal drives while in reverse; with a lever the gas pedal drives the
 * way it points, and does nothing while the truck still rolls the other way.
 */
export function drivePedalOf(throttle: number, brake: number, lever: GearLever | undefined, reversing: boolean): number {
  if (lever !== 'drive' && lever !== 'reverse') {
    return reversing ? brake : throttle;
  }
  return (lever === 'reverse') === reversing ? throttle : 0;
}

/** The pedal that brakes, as drivePedalOf() reads them: with a lever rolling the wrong way, the gas brakes too. */
export function brakePedalOf(throttle: number, brake: number, lever: GearLever | undefined, reversing: boolean): number {
  if (lever !== 'drive' && lever !== 'reverse') {
    return reversing ? throttle : brake;
  }
  return (lever === 'reverse') === reversing ? brake : Math.max(brake, throttle);
}
