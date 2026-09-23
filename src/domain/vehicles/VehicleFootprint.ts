import type { VehicleBody } from '../../data/definitions/VehicleDefinition';

/**
 * Collision shape of a truck: a row of equal circles along its length. It is
 * cheap and robust, and close enough to a box for a long, narrow vehicle.
 */
export interface VehicleFootprint {
  /** Circle centres along the heading, meters ahead of the rear axle. */
  readonly offsets: readonly number[];
  readonly radius: number;
}

/** Axles are assumed symmetric around the body centre, which sits `wheelbase / 2` ahead of the rear axle. */
export function createVehicleFootprint(body: VehicleBody): VehicleFootprint {
  const radius = body.widthMeters / 2;
  const circles = Math.max(2, Math.ceil(body.lengthMeters / body.widthMeters));
  const centre = body.wheelbaseMeters / 2;
  const reach = Math.max(0, body.lengthMeters / 2 - radius);
  const offsets = Array.from({ length: circles }, (_, index) => centre - reach + (2 * reach * index) / (circles - 1));
  return Object.freeze({ offsets: Object.freeze(offsets), radius });
}
