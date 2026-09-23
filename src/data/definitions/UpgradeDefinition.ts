import type { Validator } from '../../core/validation/Validator';
import type { Credits, Fraction } from '../units';

/**
 * Truck qualities an upgrade can improve (spec §16's StatModifier targets):
 *
 * - enginePower: engine torque and power, so acceleration and hills.
 * - fuelEfficiency: share of fuel consumption saved.
 * - brakingPower: brake force.
 * - grip: tyre grip (traction, braking and cornering on slippery ground).
 * - stability: the cornering limit before the body leans too far.
 * - cargoProtection: share of driving damage kept away from the cargo.
 * - fuelCapacity: tank size.
 */
export const VEHICLE_STATS = [
  'enginePower',
  'fuelEfficiency',
  'brakingPower',
  'grip',
  'stability',
  'cargoProtection',
  'fuelCapacity',
] as const;
export type VehicleStat = (typeof VEHICLE_STATS)[number];

/** Stats whose bonus saves a share of something: their bonus must stay below 1. */
const SAVING_STATS: readonly VehicleStat[] = ['fuelEfficiency', 'cargoProtection'];

export interface StatModifier {
  readonly stat: VehicleStat;
  /**
   * Fraction by which the stat improves: 0.1 is +10 %. For fuelEfficiency and
   * cargoProtection it is the share saved: 0.3 keeps 30 % of the damage away.
   */
  readonly bonus: Fraction;
}

/** One level of an upgrade (spec §16's UpgradeLevel). */
export interface UpgradeLevelDefinition {
  /** What fitting this level costs (spec §16's UpgradeCost). */
  readonly cost: Credits;
  /** The company level that lets the garage fit it. Omit for level 1. */
  readonly requiredCompanyLevel?: number;
  /**
   * The level's whole effect. It replaces the previous level's modifiers
   * instead of adding to them, so each level lists every stat it improves.
   */
  readonly modifiers: readonly StatModifier[];
}

/**
 * A kind of truck upgrade (spec §16's UpgradeDefinition), fitted to one truck
 * a level at a time. Player-facing names come from the string tables
 * (`upgrade.<id>.name`).
 */
export interface UpgradeDefinition {
  /** Stable snake_case id. It is written into save files: never rename it. */
  readonly id: string;
  /** Level 1 first. A truck starts with none of them. */
  readonly levels: readonly UpgradeLevelDefinition[];
}

export function validateUpgradeDefinition(upgrade: UpgradeDefinition, path: string, validator: Validator): void {
  validator.id(upgrade.id, `${path}.id`);
  if (
    !validator.check(
      Array.isArray(upgrade.levels) && upgrade.levels.length > 0,
      `${path}.levels`,
      'must be a non-empty list',
    )
  ) {
    return;
  }
  let previous: UpgradeLevelDefinition | undefined;
  upgrade.levels.forEach((level, index) => {
    const levelPath = `${path}.levels[${index}]`;
    if (!validator.check(typeof level === 'object' && level !== null, levelPath, 'must be an object')) {
      previous = undefined;
      return;
    }
    const usable = validateLevel(level, levelPath, validator);
    if (usable && previous !== undefined) {
      validateProgression(previous, level, levelPath, validator);
    }
    // A broken level cannot be compared with: the next level is only checked on its own.
    previous = usable ? level : undefined;
  });
}

/** Checks one level's own fields. Returns whether they are usable for comparing with the previous level. */
function validateLevel(level: UpgradeLevelDefinition, path: string, validator: Validator): boolean {
  let usable = validator.nonNegativeInteger(level.cost, `${path}.cost`);
  if (level.requiredCompanyLevel !== undefined) {
    usable = validator.positiveInteger(level.requiredCompanyLevel, `${path}.requiredCompanyLevel`) && usable;
  }
  if (
    !validator.check(
      Array.isArray(level.modifiers) && level.modifiers.length > 0,
      `${path}.modifiers`,
      'must be a non-empty list',
    )
  ) {
    return false;
  }
  const seen = new Set<VehicleStat>();
  level.modifiers.forEach((modifier, index) => {
    const modifierPath = `${path}.modifiers[${index}]`;
    if (!validator.check(typeof modifier === 'object' && modifier !== null, modifierPath, 'must be an object')) {
      usable = false;
      return;
    }
    if (validator.oneOf(modifier.stat, VEHICLE_STATS, `${modifierPath}.stat`)) {
      usable = validator.check(!seen.has(modifier.stat), `${modifierPath}.stat`, `"${modifier.stat}" appears twice`) && usable;
      seen.add(modifier.stat);
    } else {
      usable = false;
    }
    const bonusValid =
      validator.fraction(modifier.bonus, `${modifierPath}.bonus`) &&
      validator.check(modifier.bonus > 0, `${modifierPath}.bonus`, 'must be greater than 0') &&
      validator.check(
        !SAVING_STATS.includes(modifier.stat) || modifier.bonus < 1,
        `${modifierPath}.bonus`,
        `must be below 1: "${modifier.stat}" saves a share`,
      );
    usable = bonusValid && usable;
  });
  return usable;
}

/** A higher level never costs less, unlocks earlier, or loses part of a lower level's effect. */
function validateProgression(
  previous: UpgradeLevelDefinition,
  level: UpgradeLevelDefinition,
  path: string,
  validator: Validator,
): void {
  validator.check(level.cost >= previous.cost, `${path}.cost`, 'must not be lower than the previous level');
  validator.check(
    (level.requiredCompanyLevel ?? 1) >= (previous.requiredCompanyLevel ?? 1),
    `${path}.requiredCompanyLevel`,
    'must not be lower than the previous level',
  );
  for (const earlier of previous.modifiers) {
    const current = level.modifiers.find((modifier) => modifier.stat === earlier.stat);
    validator.check(
      current !== undefined && current.bonus >= earlier.bonus,
      `${path}.modifiers`,
      `must keep at least the previous level's ${earlier.stat} bonus`,
    );
  }
}
