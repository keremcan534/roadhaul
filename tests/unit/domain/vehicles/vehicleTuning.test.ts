import { describe, expect, it } from 'vitest';
import { VEHICLES } from '../../../../src/data/content/vehicles';
import { VehicleDynamics } from '../../../../src/domain/vehicles/VehicleDynamics';
import { GRASS } from '../../../../src/domain/world/Surface';
import { drive, input, kmh } from '../../../support/driving';

/**
 * Guard rails for how the shipped trucks feel. When a tuning change moves a
 * number out of range, decide on purpose: change the data, or the range and
 * this comment. Ranges describe a light box truck, not a car.
 */
describe.each(VEHICLES)('tuning of $id', (truck) => {
  const fullLoadKg = truck.maxPayloadTons * 1000;

  function timeToKmh(targetKmh: number, cargoKg: number): number {
    const dynamics = new VehicleDynamics(truck, cargoKg);
    const state = dynamics.createState(0, 0, 0);
    return drive(dynamics, state, input({ throttle: 1 }), 120, { until: (current) => kmh(current) >= targetKmh });
  }

  function brakingDistanceFrom90(cargoKg: number): number {
    const dynamics = new VehicleDynamics(truck, cargoKg);
    const state = dynamics.createState(0, 0, 0);
    drive(dynamics, state, input({ throttle: 1 }), 120, { until: (current) => kmh(current) >= 89.9 });
    const startZ = state.z;
    drive(dynamics, state, input({ brake: 1 }), 30, { until: (current) => current.speed === 0 });
    return state.z - startZ;
  }

  it('reaches 50 km/h briskly when empty and heavily when fully loaded', () => {
    const empty = timeToKmh(50, 0);
    const loaded = timeToKmh(50, fullLoadKg);

    expect(empty).toBeGreaterThan(5);
    expect(empty).toBeLessThan(9);
    expect(loaded).toBeGreaterThan(10);
    expect(loaded).toBeLessThan(16);
  });

  it('reaches the governor speed within half a minute when empty', () => {
    expect(timeToKmh(truck.maxSpeedKmh - 0.1, 0)).toBeLessThan(30);
  });

  it('stops from 90 km/h in a truck-like distance', () => {
    const empty = brakingDistanceFrom90(0);
    const loaded = brakingDistanceFrom90(fullLoadKg);

    expect(empty).toBeGreaterThan(35);
    expect(empty).toBeLessThan(55);
    expect(loaded).toBeGreaterThan(55);
    expect(loaded).toBeLessThan(85);
  });

  it('turns tightly enough to manoeuvre in a depot', () => {
    const radius = truck.body.wheelbaseMeters / Math.tan((truck.handling.maxSteerAngleDegrees * Math.PI) / 180);

    expect(radius).toBeGreaterThan(4.5);
    expect(radius).toBeLessThan(7);
  });

  it('corners like a truck, not a car', () => {
    expect(truck.handling.maxLateralAccelerationG).toBeLessThanOrEqual(0.5);
  });

  it('stays drivable but slow on grass', () => {
    const dynamics = new VehicleDynamics(truck, 0);
    const state = dynamics.createState(0, 0, 0);

    drive(dynamics, state, input({ throttle: 1 }), 60, { surface: GRASS });

    expect(kmh(state)).toBeGreaterThan(40);
    expect(kmh(state)).toBeLessThan(70);
  });
});
