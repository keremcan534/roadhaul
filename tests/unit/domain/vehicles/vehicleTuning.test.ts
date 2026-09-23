import { describe, expect, it } from 'vitest';
import { VEHICLES } from '../../../../src/data/content/vehicles';
import type { VehicleClass, VehicleDefinition } from '../../../../src/data/definitions/VehicleDefinition';
import { VehicleDynamics } from '../../../../src/domain/vehicles/VehicleDynamics';
import { GRASS } from '../../../../src/domain/world/Surface';
import { drive, input, kmh } from '../../../support/driving';

/** [lowest, highest] allowed. */
type Range = readonly [number, number];

interface ClassRanges {
  /** 0 to 50 km/h on asphalt, seconds. */
  readonly emptyTo50: Range;
  readonly fullyLoadedTo50: Range;
  /** Full braking from 80 km/h (every truck's governor allows it), meters. */
  readonly emptyStopFrom80: Range;
  readonly fullyLoadedStopFrom80: Range;
  /** Rear-axle radius at full lock, meters. */
  readonly turningRadius: Range;
}

/**
 * Guard rails for how the shipped trucks feel, per class. When a tuning change
 * moves a number out of range, decide on purpose: change the data, or the
 * range and this comment. A light truck is brisk and nimble; heavier classes
 * pull away and stop more slowly, above all when loaded, and need more room
 * to turn. None of them is a car.
 */
const RANGES: Readonly<Record<VehicleClass, ClassRanges>> = {
  light: {
    emptyTo50: [5, 9],
    fullyLoadedTo50: [10, 16],
    emptyStopFrom80: [28, 42],
    fullyLoadedStopFrom80: [45, 66],
    turningRadius: [4.5, 7],
  },
  medium: {
    emptyTo50: [5.5, 10],
    fullyLoadedTo50: [11, 18],
    emptyStopFrom80: [28, 44],
    fullyLoadedStopFrom80: [50, 76],
    turningRadius: [5.5, 8.5],
  },
  heavy: {
    emptyTo50: [6, 11],
    fullyLoadedTo50: [13, 22],
    emptyStopFrom80: [28, 46],
    fullyLoadedStopFrom80: [58, 90],
    turningRadius: [6.5, 10],
  },
};

function fullLoadKg(truck: VehicleDefinition): number {
  return truck.maxPayloadTons * 1000;
}

function timeToKmh(truck: VehicleDefinition, targetKmh: number, cargoKg: number): number {
  const dynamics = new VehicleDynamics(truck, cargoKg);
  const state = dynamics.createState(0, 0, 0);
  return drive(dynamics, state, input({ throttle: 1 }), 120, { until: (current) => kmh(current) >= targetKmh });
}

function brakingDistanceFrom80(truck: VehicleDefinition, cargoKg: number): number {
  const dynamics = new VehicleDynamics(truck, cargoKg);
  const state = dynamics.createState(0, 0, 0);
  drive(dynamics, state, input({ throttle: 1 }), 120, { until: (current) => kmh(current) >= 80 });
  const startZ = state.z;
  drive(dynamics, state, input({ brake: 1 }), 30, { until: (current) => current.speed === 0 });
  return state.z - startZ;
}

function turningRadius(truck: VehicleDefinition): number {
  return truck.body.wheelbaseMeters / Math.tan((truck.handling.maxSteerAngleDegrees * Math.PI) / 180);
}

function expectWithin(value: number, [lowest, highest]: Range): void {
  expect(value).toBeGreaterThanOrEqual(lowest);
  expect(value).toBeLessThanOrEqual(highest);
}

describe.each(VEHICLES)('tuning of $id ($vehicleClass)', (truck) => {
  const ranges = RANGES[truck.vehicleClass];

  it('reaches 50 km/h briskly when empty and heavily when fully loaded', () => {
    expectWithin(timeToKmh(truck, 50, 0), ranges.emptyTo50);
    expectWithin(timeToKmh(truck, 50, fullLoadKg(truck)), ranges.fullyLoadedTo50);
  });

  it('reaches the governor speed within half a minute when empty', () => {
    expect(timeToKmh(truck, truck.maxSpeedKmh - 0.1, 0)).toBeLessThan(30);
  });

  it('can reach 80 km/h fully loaded, if slowly', () => {
    expect(timeToKmh(truck, 80, fullLoadKg(truck))).toBeLessThan(60);
  });

  it('stops from 80 km/h in a truck-like distance', () => {
    expectWithin(brakingDistanceFrom80(truck, 0), ranges.emptyStopFrom80);
    expectWithin(brakingDistanceFrom80(truck, fullLoadKg(truck)), ranges.fullyLoadedStopFrom80);
  });

  it('turns tightly enough to manoeuvre in a depot', () => {
    expectWithin(turningRadius(truck), ranges.turningRadius);
  });

  it('corners like a truck, not a car', () => {
    expect(truck.handling.maxLateralAccelerationG).toBeLessThanOrEqual(0.5);
  });

  it('stays drivable but slow on grass', () => {
    const dynamics = new VehicleDynamics(truck, 0);
    const state = dynamics.createState(0, 0, 0);

    drive(dynamics, state, input({ throttle: 1 }), 60, { surface: GRASS });

    expectWithin(kmh(state), [40, 70]);
  });
});

describe('the truck roster', () => {
  const byClass = (vehicleClass: VehicleClass): VehicleDefinition[] =>
    VEHICLES.filter((truck) => truck.vehicleClass === vehicleClass);
  const [light, medium, heavy] = (['light', 'medium', 'heavy'] as const).map((vehicleClass) => byClass(vehicleClass)[0]!);

  it('has one truck of each class', () => {
    expect(VEHICLES.map((truck) => truck.vehicleClass).sort()).toEqual(['heavy', 'light', 'medium']);
  });

  it('trades speed for payload: each bigger class carries more and costs more but pulls away more slowly when full', () => {
    const ladder = [light!, medium!, heavy!];
    for (let i = 1; i < ladder.length; i++) {
      const smaller = ladder[i - 1]!;
      const bigger = ladder[i]!;
      expect(bigger.maxPayloadTons).toBeGreaterThan(smaller.maxPayloadTons);
      expect(bigger.purchasePrice).toBeGreaterThan(smaller.purchasePrice);
      expect(bigger.fuelCapacityLiters).toBeGreaterThan(smaller.fuelCapacityLiters);
      expect(bigger.baseFuelLitersPerKm).toBeGreaterThan(smaller.baseFuelLitersPerKm);
      expect(timeToKmh(bigger, 50, fullLoadKg(bigger))).toBeGreaterThan(timeToKmh(smaller, 50, fullLoadKg(smaller)));
    }
  });

  it('gives each body type a truck', () => {
    expect(new Set(VEHICLES.map((truck) => truck.bodyType))).toEqual(new Set(['box', 'refrigerated', 'flatbed']));
  });
});
