import { clamp01 } from '../../core/math/scalar';
import type { Fraction } from '../../data/units';

/**
 * Impact speed (m/s into the obstacle) that destroys the most sensitive cargo
 * (damageSensitivity 1) in one hit: a crash at about 50 km/h.
 */
export const CARGO_DESTROYING_IMPACT_SPEED = 14;

/**
 * Cargo damage from one collision. It grows with the square of the impact
 * speed, like the crash energy: a 5 km/h scrape barely marks sturdy cargo,
 * while a 25 km/h crash wrecks a quarter of fully fragile cargo.
 */
export function cargoDamageFromImpact(impactSpeedMetersPerSecond: number, damageSensitivity: Fraction): Fraction {
  const severity = Math.max(0, impactSpeedMetersPerSecond) / CARGO_DESTROYING_IMPACT_SPEED;
  return clamp01(damageSensitivity * severity * severity);
}

/** Adds a hit's damage to the cargo's existing damage, capped at 1 (destroyed). */
export function addCargoDamage(current: Fraction, added: Fraction): Fraction {
  return clamp01(current + added);
}

/** Whether the client still accepts cargo this damaged. */
export function isWithinTolerance(cargoDamage: Fraction, damageTolerance: Fraction): boolean {
  return cargoDamage <= damageTolerance;
}
