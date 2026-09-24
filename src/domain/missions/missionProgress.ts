import type { MissionDifficulty } from '../../data/definitions/MissionDefinition';
import type { Fraction } from '../../data/units';
import type { MissionFailureReason } from './MissionInstance';
import { cargoCondition, type MissionReward } from './missionReward';

/** XP per credit of total pay: spec §12's example pays 420 XP on a 5,200-credit delivery. */
export const XP_PER_CREDIT = 0.08;
/** Harder contracts teach more. */
export const DIFFICULTY_XP_BONUS: Readonly<Record<MissionDifficulty, number>> = {
  easy: 0,
  normal: 25,
  hard: 60,
  expert: 120,
};
/** Reputation for any delivery, plus the on-time share, plus up to the condition share for pristine cargo. */
export const DELIVERY_REPUTATION = 2;
export const ON_TIME_REPUTATION = 3;
export const CONDITION_REPUTATION = 5;
/** Reputation lost when a contract fails. Breaking the cargo hurts more than handing a job back. */
export const FAILURE_REPUTATION_LOSS: Readonly<Record<MissionFailureReason, number>> = {
  abandoned: 3,
  cargoDamaged: 6,
};

/** XP for a delivery (spec §12, §14). */
export function deliveryXp(reward: MissionReward, difficulty: MissionDifficulty): number {
  return Math.round(reward.total * XP_PER_CREDIT) + DIFFICULTY_XP_BONUS[difficulty];
}

/** Company reputation for a delivery: 2 to 10 (spec §12's example earns 8). */
export function deliveryReputation(reward: MissionReward, cargoDamage: Fraction, damageTolerance: Fraction): number {
  return (
    DELIVERY_REPUTATION +
    (reward.onTime ? ON_TIME_REPUTATION : 0) +
    Math.round(CONDITION_REPUTATION * cargoCondition(cargoDamage, damageTolerance))
  );
}
