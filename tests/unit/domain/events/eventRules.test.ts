import { describe, expect, it } from 'vitest';
import {
  cargoQualifies,
  deliveryQualifies,
  eventBonus,
  objectiveStep,
  type DeliveryFacts,
} from '../../../../src/domain/events/eventRules';

/** On time with 30% of the time left, undamaged, 4 t of food, paid 2000 credits. */
function delivery(overrides: Partial<DeliveryFacts> = {}): DeliveryFacts {
  return { onTime: true, timeLeft: 0.3, cargoDamage: 0, cargoWeightTons: 4, cargoCategory: 'food', pay: 2000, ...overrides };
}

describe('deliveryQualifies', () => {
  it('lets every delivery count when there are no conditions', () => {
    expect(deliveryQualifies({}, delivery({ onTime: false, timeLeft: -0.2, cargoDamage: 0.4 }))).toBe(true);
  });

  it('counts deliveries with enough of the time limit to spare, and never late ones', () => {
    const fast = { minTimeLeft: 0.25 };

    expect(deliveryQualifies(fast, delivery({ timeLeft: 0.25 }))).toBe(true);
    expect(deliveryQualifies(fast, delivery({ timeLeft: 0.2 }))).toBe(false);
    // Just on time: late by less than the grace second still counts as on time.
    expect(deliveryQualifies({ minTimeLeft: 0 }, delivery({ timeLeft: -0.001 }))).toBe(true);
    expect(deliveryQualifies({ minTimeLeft: 0 }, delivery({ onTime: false, timeLeft: -0.1 }))).toBe(false);
  });

  it('counts cargo with no more than the damage allowed', () => {
    expect(deliveryQualifies({ maxCargoDamage: 0 }, delivery())).toBe(true);
    expect(deliveryQualifies({ maxCargoDamage: 0 }, delivery({ cargoDamage: 0.01 }))).toBe(false);
  });

  it('counts heavy enough loads of the categories named, all terms together', () => {
    const heavyBuilding = { minCargoWeightTons: 8, cargoCategories: ['construction' as const] };

    expect(deliveryQualifies(heavyBuilding, delivery({ cargoWeightTons: 12, cargoCategory: 'construction' }))).toBe(true);
    expect(deliveryQualifies(heavyBuilding, delivery({ cargoWeightTons: 6, cargoCategory: 'construction' }))).toBe(false);
    expect(deliveryQualifies(heavyBuilding, delivery({ cargoWeightTons: 12 }))).toBe(false);
  });
});

describe('cargoQualifies', () => {
  it('marks contracts whose cargo alone makes them count, and none for conditions on the driving', () => {
    expect(cargoQualifies({ minCargoWeightTons: 8 }, 9, 'furniture')).toBe(true);
    expect(cargoQualifies({ minCargoWeightTons: 8 }, 4, 'furniture')).toBe(false);
    expect(cargoQualifies({ cargoCategories: ['food'] }, 1, 'food')).toBe(true);
    expect(cargoQualifies({ minTimeLeft: 0.2 }, 9, 'furniture')).toBe(false);
    expect(cargoQualifies({}, 9, 'furniture')).toBe(false);
  });
});

describe('event pay', () => {
  it('adds its share of the pay as a bonus, in whole credits', () => {
    expect(eventBonus(0.25, 2000)).toBe(500);
    expect(eventBonus(0.15, 1333)).toBe(200);
    expect(eventBonus(0, 1333)).toBe(0);
  });

  it('counts a delivery, or the credits it earned', () => {
    expect(objectiveStep({ kind: 'deliveries', target: 3 }, 2500)).toBe(1);
    expect(objectiveStep({ kind: 'credits', target: 15000 }, 2500)).toBe(2500);
  });
});
