import type { Validator } from '../../core/validation/Validator';
import type { Credits } from '../units';

/**
 * What a company facility does for the whole company, its size given per
 * level (FacilityLevelDefinition.value):
 *
 * - repairDiscount: share taken off every repair, the fleet's too.
 * - fuelDiscount: share taken off the price of diesel, the fleet's too.
 * - garageSlots: trucks the garage holds beyond the company level's.
 * - fleetPayBonus: share more the fleet's contracts pay.
 * - marketShareBonus: share more standing the company's deliveries win in
 *   the cities (against the rivals).
 * - xpBonus: share more experience a delivery brings.
 * - extraContracts: contracts of the day beyond the job board's own.
 */
export const FACILITY_EFFECTS = [
  'repairDiscount',
  'fuelDiscount',
  'garageSlots',
  'fleetPayBonus',
  'marketShareBonus',
  'xpBonus',
  'extraContracts',
] as const;
export type FacilityEffect = (typeof FACILITY_EFFECTS)[number];

/** Effects that take a share off a price: below 1, or it would be free. */
const DISCOUNTS: readonly FacilityEffect[] = ['repairDiscount', 'fuelDiscount'];
/** Effects that count things (trucks, contracts): whole numbers. */
const COUNTS: readonly FacilityEffect[] = ['garageSlots', 'extraContracts'];
/** The most a counting effect may add, and a bonus may be (+200 %). */
const MAX_COUNT = 10;
const MAX_BONUS = 2;

/** One level of a facility: what building it costs, when the company may, and the effect's size. */
export interface FacilityLevelDefinition {
  readonly cost: Credits;
  /** The company level that lets it be built. Omit for level 1. */
  readonly requiredCompanyLevel?: number;
  /**
   * The effect's whole size at this level (it replaces the level below's):
   * a share for the discounts and bonuses (0.15 is 15 %), a count for the
   * slots and contracts.
   */
  readonly value: number;
}

/**
 * A company facility (a workshop, a fuel depot, a yard…), built for the
 * whole company a level at a time. Player-facing names come from the
 * string tables (`facility.<id>.name`).
 */
export interface FacilityDefinition {
  /** Stable snake_case id. It is written into save files: never rename it. */
  readonly id: string;
  readonly effect: FacilityEffect;
  /** Level 1 first. A new company has none of them. */
  readonly levels: readonly FacilityLevelDefinition[];
}

export function validateFacilityDefinition(facility: FacilityDefinition, path: string, validator: Validator): void {
  validator.id(facility.id, `${path}.id`);
  const effectValid = validator.oneOf(facility.effect, FACILITY_EFFECTS, `${path}.effect`);
  if (
    !validator.check(
      Array.isArray(facility.levels) && facility.levels.length > 0,
      `${path}.levels`,
      'must be a non-empty list',
    )
  ) {
    return;
  }
  let previous: FacilityLevelDefinition | undefined;
  facility.levels.forEach((level, index) => {
    const levelPath = `${path}.levels[${index}]`;
    if (!validator.check(typeof level === 'object' && level !== null, levelPath, 'must be an object')) {
      previous = undefined;
      return;
    }
    let usable = validator.nonNegativeInteger(level.cost, `${levelPath}.cost`);
    if (level.requiredCompanyLevel !== undefined) {
      usable = validator.positiveInteger(level.requiredCompanyLevel, `${levelPath}.requiredCompanyLevel`) && usable;
    }
    usable = (effectValid && validateValue(facility.effect, level.value, `${levelPath}.value`, validator)) && usable;
    if (usable && previous !== undefined) {
      // A higher level never costs less, unlocks earlier, or does less.
      validator.check(level.cost >= previous.cost, `${levelPath}.cost`, 'must not be lower than the previous level');
      validator.check(
        (level.requiredCompanyLevel ?? 1) >= (previous.requiredCompanyLevel ?? 1),
        `${levelPath}.requiredCompanyLevel`,
        'must not be lower than the previous level',
      );
      validator.check(level.value > previous.value, `${levelPath}.value`, 'must be more than the previous level');
    }
    previous = usable ? level : undefined;
  });
}

/** A level's value suits its effect: a share below 1 for a discount, a whole count, a bonus up to +200 %. */
function validateValue(effect: FacilityEffect, value: number, path: string, validator: Validator): boolean {
  if (!validator.check(typeof value === 'number' && Number.isFinite(value) && value > 0, path, 'must be a number above 0')) {
    return false;
  }
  if (DISCOUNTS.includes(effect)) {
    return validator.check(value < 1, path, `must be below 1: "${effect}" takes a share off`);
  }
  if (COUNTS.includes(effect)) {
    return validator.check(Number.isInteger(value) && value <= MAX_COUNT, path, `must be a whole number up to ${MAX_COUNT}`);
  }
  return validator.check(value <= MAX_BONUS, path, `must be at most ${MAX_BONUS}`);
}
