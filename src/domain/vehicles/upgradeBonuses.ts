import {
  UPGRADE_LOOKS,
  VEHICLE_STATS,
  type UpgradeDefinition,
  type UpgradeLook,
  type VehicleStat,
} from '../../data/definitions/UpgradeDefinition';
import type { PerformanceFactors } from './performance';

/**
 * The upgrade levels fitted to one truck: upgrade id → level (1 is the first
 * level). Upgrades it does not list are not fitted.
 */
export type FittedUpgrades = Readonly<Record<string, number>>;

/** Each stat's total bonus from a truck's fitted upgrades (see StatModifier.bonus). */
export type StatBonuses = Readonly<Record<VehicleStat, number>>;

/** A saving never reaches everything: fuel still burns and hard crashes still hurt the cargo. */
export const MAX_SAVING = 0.9;

/**
 * Adds up the modifiers of every fitted level (spec §16's StatModifier).
 * Each upgrade counts its fitted level only, which already includes what the
 * lower levels gave. Unknown upgrades and levels outside 1..max are ignored.
 */
export function statBonuses(fitted: FittedUpgrades, upgrades: readonly UpgradeDefinition[]): StatBonuses {
  const bonuses: Record<VehicleStat, number> = {
    enginePower: 0,
    fuelEfficiency: 0,
    brakingPower: 0,
    grip: 0,
    stability: 0,
    cargoProtection: 0,
    fuelCapacity: 0,
  };
  for (const upgrade of upgrades) {
    const level = fittedUpgradeLevel(fitted, upgrade);
    const modifiers = level > 0 ? upgrade.levels[level - 1]!.modifiers : [];
    for (const modifier of modifiers) {
      bonuses[modifier.stat] += modifier.bonus;
    }
  }
  bonuses.fuelEfficiency = Math.min(MAX_SAVING, bonuses.fuelEfficiency);
  bonuses.cargoProtection = Math.min(MAX_SAVING, bonuses.cargoProtection);
  return bonuses;
}

/** The level of `upgrade` fitted to a truck: 0 when none (or an unusable value). */
export function fittedUpgradeLevel(fitted: FittedUpgrades, upgrade: UpgradeDefinition): number {
  const level = Object.hasOwn(fitted, upgrade.id) ? fitted[upgrade.id] : 0;
  return Number.isInteger(level) && level! >= 1 && level! <= upgrade.levels.length ? level! : 0;
}

/** How far along each part of the truck shows its upgrades: look → level, 0 for none. */
export type TruckLooks = Readonly<Record<UpgradeLook, number>>;

/**
 * What a truck's fitted upgrades look like (UpgradeDefinition.look): each
 * part at the fitted level of the upgrade it shows, the highest if two show
 * on the same part.
 */
export function truckLooks(fitted: FittedUpgrades, upgrades: readonly UpgradeDefinition[]): TruckLooks {
  const looks = Object.fromEntries(UPGRADE_LOOKS.map((look) => [look, 0])) as Record<UpgradeLook, number>;
  for (const upgrade of upgrades) {
    looks[upgrade.look] = Math.max(looks[upgrade.look], fittedUpgradeLevel(fitted, upgrade));
  }
  return looks;
}

/** How the bonuses change the way the truck drives. */
export function upgradePerformance(bonuses: StatBonuses): PerformanceFactors {
  return {
    torqueFactor: 1 + bonuses.enginePower,
    brakeFactor: 1 + bonuses.brakingPower,
    gripFactor: 1 + bonuses.grip,
    stabilityFactor: 1 + bonuses.stability,
  };
}

/** Every stat at 0: a truck with nothing fitted. */
export const NO_BONUSES: StatBonuses = Object.freeze(
  Object.fromEntries(VEHICLE_STATS.map((stat) => [stat, 0])) as Record<VehicleStat, number>,
);
