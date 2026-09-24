import { describe, expect, it } from 'vitest';
import {
  CONDITION_REPUTATION,
  DELIVERY_REPUTATION,
  deliveryReputation,
  deliveryXp,
  DIFFICULTY_XP_BONUS,
  ON_TIME_REPUTATION,
} from '../../../../src/domain/missions/missionProgress';
import { calculateMissionReward, cargoCondition } from '../../../../src/domain/missions/missionReward';

function reward(overrides: { deliverySeconds?: number; cargoDamage?: number } = {}) {
  return calculateMissionReward({
    baseReward: 4200,
    cargoRewardMultiplier: 1,
    timeSensitivity: 0.5,
    timeLimitSeconds: 100,
    deliverySeconds: overrides.deliverySeconds ?? 50,
    cargoDamage: overrides.cargoDamage ?? 0,
    damageTolerance: 0.2,
  });
}

describe('delivery progress', () => {
  it('pays XP in line with the spec example: about 420 XP for a 5,200-credit delivery', () => {
    const delivery = { ...reward(), total: 5200 };

    expect(deliveryXp(delivery, 'easy')).toBe(416);
    expect(deliveryXp(delivery, 'expert')).toBe(416 + DIFFICULTY_XP_BONUS.expert);
  });

  it('pays the most reputation for pristine cargo on time, never less than for delivering at all', () => {
    const best = DELIVERY_REPUTATION + ON_TIME_REPUTATION + CONDITION_REPUTATION;

    expect(deliveryReputation(reward(), 0, 0.2)).toBe(best);
    // Half the condition earns 2.5 of the 5 condition points, rounded to 3.
    expect(deliveryReputation(reward({ cargoDamage: 0.1 }), 0.1, 0.2)).toBe(best - 2);
    expect(deliveryReputation(reward({ deliverySeconds: 150, cargoDamage: 0.2 }), 0.2, 0.2)).toBe(DELIVERY_REPUTATION);
  });
});

describe('cargoCondition', () => {
  it('runs from 1 for pristine cargo to 0 at the tolerance', () => {
    expect(cargoCondition(0, 0.2)).toBe(1);
    expect(cargoCondition(0.05, 0.2)).toBeCloseTo(0.75, 12);
    expect(cargoCondition(0.2, 0.2)).toBe(0);
    expect(cargoCondition(0.3, 0.2)).toBe(0);
  });

  it('accepts only pristine cargo under a zero tolerance', () => {
    expect(cargoCondition(0, 0)).toBe(1);
    expect(cargoCondition(0.001, 0)).toBe(0);
  });
});
