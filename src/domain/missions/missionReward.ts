import { clamp01 } from '../../core/math/scalar';
import type { Credits, Fraction } from '../../data/units';

/** On-time bonus: this share of the base pay for cargo that is not time-sensitive… */
export const ON_TIME_BONUS_MIN: Fraction = 0.1;
/** …plus this share times the cargo's timeSensitivity. */
export const ON_TIME_BONUS_PER_TIME_SENSITIVITY: Fraction = 0.2;
/** The late penalty never takes more than this share of the base pay (spec §64: penalties must not wipe out the job). */
export const LATE_PENALTY_MAX: Fraction = 0.5;
/** Condition bonus for pristine cargo, as a share of the base pay. It shrinks to 0 at the damage tolerance. */
export const CONDITION_BONUS_MAX: Fraction = 0.2;
/** Deliveries up to this late still count as on time: nobody should lose a bonus to a frame. */
export const LATE_GRACE_SECONDS = 1;

export interface MissionRewardInput {
  readonly baseReward: Credits;
  /** The cargo's rewardMultiplier ("CargoMultiplier", spec §64). */
  readonly cargoRewardMultiplier: number;
  readonly timeSensitivity: Fraction;
  readonly timeLimitSeconds: number;
  /** Seconds from loading to unloading. */
  readonly deliverySeconds: number;
  readonly cargoDamage: Fraction;
  readonly damageTolerance: Fraction;
}

/** The pay for a contract before bonuses and penalties: its reward times the cargo multiplier, in whole credits. */
export function missionBasePay(baseReward: Credits, cargoRewardMultiplier: number): Credits {
  return Math.round(baseReward * cargoRewardMultiplier);
}

/** A successful delivery's pay, itemised for the result screen (spec §12). Every item is whole credits. */
export interface MissionReward {
  readonly basePay: Credits;
  /** Paid when delivered within the time limit; 0 when late. */
  readonly timeBonus: Credits;
  /** Deducted when late (a positive number); 0 when on time. */
  readonly latePenalty: Credits;
  /** Paid for careful driving: the less cargo damage, the more. */
  readonly conditionBonus: Credits;
  /** basePay + timeBonus + conditionBonus - latePenalty. Always positive for a paid job. */
  readonly total: Credits;
  readonly onTime: boolean;
  /** Seconds over the time limit; 0 when on time (including the grace second). */
  readonly lateSeconds: number;
}

/**
 * Pay for a delivered mission. The base pay is the contract's reward times
 * the cargo multiplier. Punctual deliveries earn a bonus that grows with the
 * cargo's time sensitivity; late ones lose pay in proportion to how late they
 * are, scaled by the same sensitivity and capped at LATE_PENALTY_MAX. Undamaged
 * cargo earns the full condition bonus. Cargo beyond the damage tolerance is
 * not delivered at all (the mission fails), so it never reaches this function.
 */
export function calculateMissionReward(input: MissionRewardInput): MissionReward {
  const basePay = missionBasePay(input.baseReward, input.cargoRewardMultiplier);
  const overtime = input.deliverySeconds - input.timeLimitSeconds;
  const onTime = overtime <= LATE_GRACE_SECONDS;
  const lateSeconds = onTime ? 0 : overtime;

  const timeBonus = onTime
    ? Math.round(basePay * (ON_TIME_BONUS_MIN + ON_TIME_BONUS_PER_TIME_SENSITIVITY * input.timeSensitivity))
    : 0;
  const lateShare = (lateSeconds / input.timeLimitSeconds) * (0.5 + input.timeSensitivity);
  // Rounded like the other items, but never past the cap, even by half a credit.
  const latePenalty = onTime
    ? 0
    : Math.min(Math.round(basePay * lateShare), Math.floor(basePay * LATE_PENALTY_MAX));

  const conditionBonus = Math.round(basePay * CONDITION_BONUS_MAX * cargoCondition(input.cargoDamage, input.damageTolerance));

  return {
    basePay,
    timeBonus,
    latePenalty,
    conditionBonus,
    total: basePay + timeBonus + conditionBonus - latePenalty,
    onTime,
    lateSeconds,
  };
}

/**
 * How well the cargo arrived, 1 (pristine) to 0 (at the damage tolerance, the
 * worst the client accepts). With a zero tolerance only pristine cargo counts.
 */
export function cargoCondition(cargoDamage: Fraction, damageTolerance: Fraction): Fraction {
  if (damageTolerance > 0) {
    return clamp01(1 - cargoDamage / damageTolerance);
  }
  return cargoDamage === 0 ? 1 : 0;
}
