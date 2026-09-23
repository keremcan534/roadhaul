import type { VehicleDefinition } from '../../data/definitions/VehicleDefinition';
import type { Fraction } from '../../data/units';

/** A fully loaded truck burns this much more than an empty one… */
export const FULL_LOAD_EXTRA: Fraction = 0.5;
/** …one at its governed top speed this much more than a crawling one (air drag grows with speed)… */
export const TOP_SPEED_EXTRA: Fraction = 0.4;
/** …and a wrecked one this much more than a healthy one. */
export const FULL_DAMAGE_EXTRA: Fraction = 0.3;

/**
 * Litres of fuel burnt driving `distanceMeters` (spec §17): distance × the
 * truck's base consumption × load × terrain × speed × condition. The map is a
 * miniature, so `consumptionScale` stretches every metre driven into more
 * road. Allocation-free: it runs every fixed step.
 */
export function fuelUsedLiters(
  distanceMeters: number,
  vehicle: VehicleDefinition,
  cargoTons: number,
  terrainFactor: number,
  speedMetersPerSecond: number,
  damage: Fraction,
  consumptionScale: number,
): number {
  if (!(distanceMeters > 0)) {
    return 0;
  }
  const load = 1 + FULL_LOAD_EXTRA * Math.min(1, Math.max(0, cargoTons) / vehicle.maxPayloadTons);
  const topSpeed = vehicle.maxSpeedKmh / 3.6;
  const speedShare = Math.min(1, Math.abs(speedMetersPerSecond) / topSpeed);
  const speed = 1 + TOP_SPEED_EXTRA * speedShare * speedShare;
  const condition = 1 + FULL_DAMAGE_EXTRA * Math.min(1, Math.max(0, damage));
  return (distanceMeters / 1000) * vehicle.baseFuelLitersPerKm * load * terrainFactor * speed * condition * consumptionScale;
}
