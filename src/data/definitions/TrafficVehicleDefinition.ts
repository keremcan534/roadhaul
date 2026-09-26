import type { Validator } from '../../core/validation/Validator';

/** Spec §19's first traffic: cars, minibuses, trucks and buses. */
export const TRAFFIC_VEHICLE_KINDS = ['car', 'minibus', 'truck', 'bus'] as const;
export type TrafficVehicleKind = (typeof TRAFFIC_VEHICLE_KINDS)[number];

/** A car's body: a hatchback, its rear window down to the tail, or a saloon with a boot behind the rear window. */
export const TRAFFIC_CAR_BODIES = ['hatchback', 'saloon'] as const;
export type TrafficCarBody = (typeof TRAFFIC_CAR_BODIES)[number];

/**
 * A kind of NPC vehicle (spec §19). Shapes are generic and original: no
 * real-world makes or models. Names never reach the player.
 */
export interface TrafficVehicleDefinition {
  /** Stable snake_case id. */
  readonly id: string;
  readonly kind: TrafficVehicleKind;
  /** A car's body (cars only): a hatchback when left out. */
  readonly carBody?: TrafficCarBody;
  readonly lengthMeters: number;
  readonly widthMeters: number;
  readonly heightMeters: number;
  /** Its cruising speed as a share of the road's speed limit (1 = the limit). */
  readonly cruiseSpeedFactor: number;
  /** Top acceleration, m/s²: heavy vehicles pull away slowly. */
  readonly accelerationMetersPerSecondSquared: number;
  /** How often it appears, relative to the other kinds. */
  readonly spawnWeight: number;
  /** Body colours, 0xRRGGBB, one picked per vehicle. */
  readonly colors: readonly number[];
}

export function validateTrafficVehicleDefinition(
  vehicle: TrafficVehicleDefinition,
  path: string,
  validator: Validator,
): void {
  validator.id(vehicle.id, `${path}.id`);
  validator.oneOf(vehicle.kind, TRAFFIC_VEHICLE_KINDS, `${path}.kind`);
  if (vehicle.carBody !== undefined) {
    validator.oneOf(vehicle.carBody, TRAFFIC_CAR_BODIES, `${path}.carBody`);
    validator.check(vehicle.kind === 'car', `${path}.carBody`, 'is a car\'s only');
  }
  validator.positiveNumber(vehicle.lengthMeters, `${path}.lengthMeters`);
  validator.positiveNumber(vehicle.widthMeters, `${path}.widthMeters`);
  validator.positiveNumber(vehicle.heightMeters, `${path}.heightMeters`);
  validator.check(
    Number.isFinite(vehicle.cruiseSpeedFactor) && vehicle.cruiseSpeedFactor > 0 && vehicle.cruiseSpeedFactor <= 1.2,
    `${path}.cruiseSpeedFactor`,
    'must be greater than 0 and at most 1.2',
  );
  validator.positiveNumber(vehicle.accelerationMetersPerSecondSquared, `${path}.accelerationMetersPerSecondSquared`);
  validator.positiveNumber(vehicle.spawnWeight, `${path}.spawnWeight`);
  validator.check(
    Array.isArray(vehicle.colors) &&
      vehicle.colors.length > 0 &&
      vehicle.colors.every((color) => Number.isInteger(color) && color >= 0 && color <= 0xffffff),
    `${path}.colors`,
    'must list at least one 0xRRGGBB colour',
  );
}
