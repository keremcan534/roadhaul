import { describe, expect, it } from 'vitest';
import { ComfortMeter, COMFORT_STAR, coachRunPay, dwellSeconds, peopleGettingOff, peopleWaiting } from '../../../../src/domain/coach/coachRun';

const RULES = { fareCredits: 70, onTimeBonusShare: 0.25, comfortBonusShare: 0.25, xpPerPassenger: 4 };

describe('coachRun', () => {
  it('has more people waiting in the rush hours and fewer at night, within the range by day', () => {
    const range = [4, 10] as const;
    expect(peopleWaiting(range, 12, 0)).toBe(4);
    expect(peopleWaiting(range, 12, 1)).toBe(10);
    expect(peopleWaiting(range, 8, 1)).toBe(15);
    expect(peopleWaiting(range, 17.5, 0.5)).toBe(11);
    expect(peopleWaiting(range, 23, 1)).toBe(4);
    expect(peopleWaiting(range, 3, 0)).toBe(1);
  });

  it('lets a share off at a stop, and everyone at the last', () => {
    expect(peopleGettingOff(20, 0.4, false)).toBe(8);
    expect(peopleGettingOff(20, 0.4, true)).toBe(20);
    expect(peopleGettingOff(0, 0.4, false)).toBe(0);
  });

  it('takes longer at a stop the more people get off and on', () => {
    expect(dwellSeconds(3, 0.7, 0)).toBe(3);
    expect(dwellSeconds(3, 0.7, 10)).toBeCloseTo(10);
  });

  it('keeps comfort for a gentle ride and loses it for hard pulls and knocks', () => {
    const meter = new ComfortMeter(2.2, 5, 15);
    meter.ride(2, -2, 1);
    expect(meter.value).toBe(100);
    meter.ride(-4.2, 0, 1); // braking hard: 2 m/s² over, for a second
    expect(meter.value).toBeCloseTo(90);
    meter.knock();
    expect(meter.value).toBeCloseTo(75);
    for (let i = 0; i < 100; i++) {
      meter.knock();
    }
    expect(meter.value).toBe(0);
    meter.reset();
    expect(meter.value).toBe(100);
  });

  it('pays the fares, a bonus for keeping time and one for comfort, with a star each', () => {
    expect(coachRunPay(RULES, { passengers: 20, finished: true, allOnTime: true, comfort: 100 })).toEqual({
      passengers: 20,
      fares: 1400,
      onTimeBonus: 350,
      comfortBonus: 350,
      total: 2100,
      xp: 80,
      stars: 3,
    });
    expect(coachRunPay(RULES, { passengers: 20, finished: true, allOnTime: false, comfort: COMFORT_STAR - 1 })).toMatchObject({
      onTimeBonus: 0,
      comfortBonus: Math.round(1400 * 0.25 * 0.79),
      stars: 1,
    });
  });

  it('pays only the fares of a run given up, without a star', () => {
    expect(coachRunPay(RULES, { passengers: 6, finished: false, allOnTime: true, comfort: 100 })).toEqual({
      passengers: 6,
      fares: 420,
      onTimeBonus: 0,
      comfortBonus: 0,
      total: 420,
      xp: 24,
      stars: 0,
    });
  });
});
