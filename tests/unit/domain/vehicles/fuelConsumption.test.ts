import { describe, expect, it } from 'vitest';
import {
  FULL_DAMAGE_EXTRA,
  FULL_LOAD_EXTRA,
  fuelUsedLiters,
  TOP_SPEED_EXTRA,
} from '../../../../src/domain/vehicles/fuelConsumption';
import { vehicleFixture } from '../../../support/contentFixtures';

// 0.3 L/km, 10 t payload, 90 km/h governor (25 m/s).
const truck = vehicleFixture();

describe('fuelUsedLiters', () => {
  it('burns the base consumption per kilometre for an empty, healthy truck crawling on asphalt', () => {
    expect(fuelUsedLiters(1000, truck, 0, 1, 0, 0, 1)).toBeCloseTo(0.3, 12);
    expect(fuelUsedLiters(1000, truck, 0, 1, 0, 0, 60)).toBeCloseTo(18, 9);
  });

  it('burns more with cargo, off-road, at speed and when damaged (spec §17)', () => {
    const base = fuelUsedLiters(1000, truck, 0, 1, 0, 0, 1);

    expect(fuelUsedLiters(1000, truck, 10, 1, 0, 0, 1)).toBeCloseTo(base * (1 + FULL_LOAD_EXTRA), 12);
    expect(fuelUsedLiters(1000, truck, 5, 1, 0, 0, 1)).toBeCloseTo(base * (1 + FULL_LOAD_EXTRA / 2), 12);
    expect(fuelUsedLiters(1000, truck, 0, 1.35, 0, 0, 1)).toBeCloseTo(base * 1.35, 12);
    expect(fuelUsedLiters(1000, truck, 0, 1, 25, 0, 1)).toBeCloseTo(base * (1 + TOP_SPEED_EXTRA), 12);
    expect(fuelUsedLiters(1000, truck, 0, 1, -12.5, 0, 1)).toBeCloseTo(base * (1 + TOP_SPEED_EXTRA / 4), 12);
    expect(fuelUsedLiters(1000, truck, 0, 1, 0, 1, 1)).toBeCloseTo(base * (1 + FULL_DAMAGE_EXTRA), 12);
  });

  it('caps overloading and ignores nonsense', () => {
    const base = fuelUsedLiters(1000, truck, 0, 1, 0, 0, 1);

    expect(fuelUsedLiters(1000, truck, 50, 1, 0, 0, 1)).toBeCloseTo(base * (1 + FULL_LOAD_EXTRA), 12);
    expect(fuelUsedLiters(0, truck, 0, 1, 0, 0, 1)).toBe(0);
    expect(fuelUsedLiters(-5, truck, 0, 1, 0, 0, 1)).toBe(0);
    expect(fuelUsedLiters(Number.NaN, truck, 0, 1, 0, 0, 1)).toBe(0);
  });
});
