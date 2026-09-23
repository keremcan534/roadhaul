import { describe, expect, it } from 'vitest';
import {
  calculateMissionReward,
  LATE_PENALTY_MAX,
  type MissionRewardInput,
} from '../../../../src/domain/missions/missionReward';

function input(overrides: Partial<MissionRewardInput> = {}): MissionRewardInput {
  return {
    baseReward: 1000,
    cargoRewardMultiplier: 1,
    timeSensitivity: 0.5,
    timeLimitSeconds: 100,
    deliverySeconds: 80,
    cargoDamage: 0,
    damageTolerance: 0.2,
    ...overrides,
  };
}

describe('calculateMissionReward', () => {
  it('pays base, on-time bonus and condition bonus for a clean, punctual delivery', () => {
    expect(calculateMissionReward(input())).toEqual({
      basePay: 1000,
      timeBonus: 200, // 10% + 20% × 0.5 time sensitivity
      latePenalty: 0,
      conditionBonus: 200,
      total: 1400,
      onTime: true,
      lateSeconds: 0,
    });
  });

  it('multiplies the base pay by the cargo multiplier, in whole credits', () => {
    expect(calculateMissionReward(input({ baseReward: 1001, cargoRewardMultiplier: 1.5 })).basePay).toBe(1502);
  });

  it('pays a bigger on-time bonus for time-sensitive cargo', () => {
    expect(calculateMissionReward(input({ timeSensitivity: 0 })).timeBonus).toBe(100);
    expect(calculateMissionReward(input({ timeSensitivity: 1 })).timeBonus).toBe(300);
  });

  it('counts a delivery at the limit, or less than a second over it, as on time', () => {
    expect(calculateMissionReward(input({ deliverySeconds: 100 })).onTime).toBe(true);
    expect(calculateMissionReward(input({ deliverySeconds: 100.9 }))).toMatchObject({ onTime: true, lateSeconds: 0 });
    expect(calculateMissionReward(input({ deliverySeconds: 101.5 }))).toMatchObject({ onTime: false, lateSeconds: 1.5 });
  });

  it('takes pay in proportion to lateness and time sensitivity', () => {
    // 10% late × (0.5 + 0.5) = 10% of the base pay.
    const late = calculateMissionReward(input({ deliverySeconds: 110 }));

    expect(late).toMatchObject({ onTime: false, lateSeconds: 10, timeBonus: 0, latePenalty: 100, total: 1100 });
    expect(calculateMissionReward(input({ deliverySeconds: 110, timeSensitivity: 1 })).latePenalty).toBe(150);
  });

  it('caps the late penalty, so a late job still pays (spec §64)', () => {
    const veryLate = calculateMissionReward(input({ deliverySeconds: 10_000, timeSensitivity: 1 }));

    expect(veryLate.latePenalty).toBe(1000 * LATE_PENALTY_MAX);
    expect(veryLate.total).toBe(700); // half the base pay plus the condition bonus
  });

  it('shrinks the condition bonus to nothing at the damage tolerance', () => {
    expect(calculateMissionReward(input({ cargoDamage: 0.1 })).conditionBonus).toBe(100);
    expect(calculateMissionReward(input({ cargoDamage: 0.2 })).conditionBonus).toBe(0);
  });

  it('pays the condition bonus under a zero tolerance only for pristine cargo', () => {
    expect(calculateMissionReward(input({ damageTolerance: 0 })).conditionBonus).toBe(200);
    expect(calculateMissionReward(input({ damageTolerance: 0, cargoDamage: 0.01 })).conditionBonus).toBe(0);
  });

  it('itemises exactly: the items always add up to the total, which never drops below half the base pay', () => {
    for (const deliverySeconds of [0, 37, 100, 101, 163, 420]) {
      for (const cargoDamage of [0, 0.03, 0.17, 0.2]) {
        for (const timeSensitivity of [0, 0.35, 1]) {
          const reward = calculateMissionReward(
            input({ baseReward: 1234, cargoRewardMultiplier: 1.15, deliverySeconds, cargoDamage, timeSensitivity }),
          );
          expect(reward.total).toBe(reward.basePay + reward.timeBonus + reward.conditionBonus - reward.latePenalty);
          expect(reward.total).toBeGreaterThanOrEqual(reward.basePay / 2);
          expect(Number.isInteger(reward.total)).toBe(true);
        }
      }
    }
  });
});
