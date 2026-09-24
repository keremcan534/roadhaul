import { clamp01 } from '../../core/math/scalar';
import type { Fraction } from '../../data/units';
import type { PerformanceFactors } from './performance';

/** Damage bands (spec §18): 0–20% minor, 21–50% damaged, 51–80% severe, 81–100% critical. */
export const DAMAGE_BANDS = ['minor', 'damaged', 'severe', 'critical'] as const;
export type DamageBand = (typeof DAMAGE_BANDS)[number];

/** Impact speed (m/s into the obstacle) that would wreck the truck in one hit; a 50 km/h crash costs about a quarter. */
export const TRUCK_WRECKING_IMPACT_SPEED = 28;
/** A wrecked truck keeps this share of its engine torque… */
export const WRECKED_TORQUE_FACTOR = 0.65;
/** …and of its braking. It still drives: damage must never strand the player (spec §18). */
export const WRECKED_BRAKE_FACTOR = 0.75;

export function damageBand(damage: Fraction): DamageBand {
  if (damage <= 0.2) {
    return 'minor';
  }
  if (damage <= 0.5) {
    return 'damaged';
  }
  return damage <= 0.8 ? 'severe' : 'critical';
}

/** Truck damage from one collision. It grows with the square of the impact speed, like the crash energy. */
export function truckDamageFromImpact(impactSpeedMetersPerSecond: number): Fraction {
  const severity = Math.max(0, impactSpeedMetersPerSecond) / TRUCK_WRECKING_IMPACT_SPEED;
  return clamp01(severity * severity);
}

/** How much of its engine and brakes a truck with `damage` still has. Tyres and body are unaffected. */
export function damagePerformance(damage: Fraction): PerformanceFactors {
  const d = clamp01(damage);
  return {
    torqueFactor: 1 - (1 - WRECKED_TORQUE_FACTOR) * d,
    brakeFactor: 1 - (1 - WRECKED_BRAKE_FACTOR) * d,
    gripFactor: 1,
    stabilityFactor: 1,
  };
}
