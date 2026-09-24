import { describe, expect, it } from 'vitest';
import { Validator } from '../../../../src/core/validation/Validator';
import { EVENTS } from '../../../../src/data/content/events';
import {
  utcMidnightMs,
  validateEventDefinition,
  type EventDefinition,
} from '../../../../src/data/definitions/EventDefinition';
import { eventFixture } from '../../../support/contentFixtures';

function issues(event: EventDefinition): string[] {
  const validator = new Validator();
  validateEventDefinition(event, 'event', validator);
  return validator.issues.map((issue) => issue.path);
}

describe('validateEventDefinition', () => {
  it('accepts the built-in events and the test fixture', () => {
    for (const event of [...EVENTS, eventFixture()]) {
      expect(issues(event), event.id).toEqual([]);
    }
  });

  it('ships the three events of spec §78, one or two of them on at any time', () => {
    expect(EVENTS.map((event) => event.id)).toEqual(['express_week', 'safe_driver', 'heavy_cargo']);
    const [express, safe, heavy] = EVENTS as [EventDefinition, EventDefinition, EventDefinition];
    // Express Week: fast deliveries; Safe Driver: no damage; Heavy Cargo: heavy loads, from level 2.
    expect(express.qualifyingDelivery.minTimeLeft).toBeGreaterThan(0);
    expect(safe.qualifyingDelivery.maxCargoDamage).toBe(0);
    expect(heavy.qualifyingDelivery.minCargoWeightTons).toBeGreaterThanOrEqual(8);
    expect(heavy.requiredCompanyLevel).toBe(2);
    // Express Week and Safe Driver take turns, week by week: one of them is always on.
    const expressStart = utcMidnightMs(express.schedule.startDate);
    const safeStart = utcMidnightMs(safe.schedule.startDate);
    expect(safeStart - expressStart).toBe(7 * 24 * 60 * 60 * 1000);
    for (const event of [express, safe]) {
      expect(event.schedule).toMatchObject({ durationDays: 7, repeatEveryDays: 14 });
    }
    // All three start their runs at midnight UTC on a Monday, or a Thursday.
    for (const event of EVENTS) {
      expect([1, 4]).toContain(new Date(utcMidnightMs(event.schedule.startDate)).getUTCDay());
    }
  });

  it('reports schedules, conditions, objectives and rewards out of range', () => {
    const event = eventFixture({
      id: 'Summer Rush',
      schedule: { startDate: '2026-02-30', durationDays: 7.5, repeatEveryDays: 3 },
      requiredCompanyLevel: 0,
      qualifyingDelivery: { minTimeLeft: 1.5, maxCargoDamage: -0.1, minCargoWeightTons: 0, cargoCategories: [] },
      objective: { kind: 'distance' as never, target: 0 },
      reward: { credits: 99.5, xp: -1 },
      payBonus: 2,
    });

    expect(issues(event)).toEqual([
      'event.id',
      'event.schedule.startDate',
      'event.schedule.durationDays',
      'event.schedule.repeatEveryDays',
      'event.requiredCompanyLevel',
      'event.qualifyingDelivery.minTimeLeft',
      'event.qualifyingDelivery.maxCargoDamage',
      'event.qualifyingDelivery.minCargoWeightTons',
      'event.qualifyingDelivery.cargoCategories',
      'event.objective.kind',
      'event.objective.target',
      'event.reward.credits',
      'event.reward.xp',
      'event.payBonus',
    ]);
    expect(
      issues(eventFixture({ qualifyingDelivery: { cargoCategories: ['food', 'plutonium' as never] } })),
    ).toEqual(['event.qualifyingDelivery.cargoCategories[1]']);
    expect(issues({ ...eventFixture(), schedule: null as never, objective: null as never })).toEqual([
      'event.schedule',
      'event.objective',
    ]);
  });
});

describe('utcMidnightMs', () => {
  it('reads real dates as midnight UTC, and nothing else', () => {
    expect(utcMidnightMs('2026-01-05')).toBe(Date.UTC(2026, 0, 5));
    expect(utcMidnightMs('2028-02-29')).toBe(Date.UTC(2028, 1, 29));
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-5', '05.01.2026', '']) {
      expect(utcMidnightMs(bad), bad).toBeNaN();
    }
  });
});
