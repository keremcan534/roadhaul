import { describe, expect, it } from 'vitest';
import {
  damageBand,
  damagePerformance,
  TRUCK_WRECKING_IMPACT_SPEED,
  truckDamageFromImpact,
  WRECKED_BRAKE_FACTOR,
  WRECKED_TORQUE_FACTOR,
} from '../../../../src/domain/vehicles/vehicleDamage';

describe('truck damage', () => {
  it('sorts damage into the spec §18 bands', () => {
    expect([0, 0.2, 0.21, 0.5, 0.51, 0.8, 0.81, 1].map(damageBand)).toEqual([
      'minor',
      'minor',
      'damaged',
      'damaged',
      'severe',
      'severe',
      'critical',
      'critical',
    ]);
  });

  it('grows with the square of the impact speed: a 50 km/h crash costs about a quarter', () => {
    expect(truckDamageFromImpact(TRUCK_WRECKING_IMPACT_SPEED)).toBeCloseTo(1, 12);
    expect(truckDamageFromImpact(14)).toBeCloseTo(0.25, 12);
    expect(truckDamageFromImpact(1.5)).toBeLessThan(0.005);
    expect(truckDamageFromImpact(100)).toBe(1);
    expect(truckDamageFromImpact(-3)).toBe(0);
  });

  it('weakens the engine and brakes, but never takes them away', () => {
    expect(damagePerformance(0)).toEqual({ torqueFactor: 1, brakeFactor: 1, gripFactor: 1, stabilityFactor: 1 });
    expect(damagePerformance(1).torqueFactor).toBeCloseTo(WRECKED_TORQUE_FACTOR, 12);
    expect(damagePerformance(1).brakeFactor).toBeCloseTo(WRECKED_BRAKE_FACTOR, 12);
    expect(damagePerformance(0.5).torqueFactor).toBeCloseTo((1 + WRECKED_TORQUE_FACTOR) / 2, 12);
    expect(damagePerformance(7)).toEqual(damagePerformance(1));
  });
});
