import type { FacilityDefinition, FacilityEffect, FacilityLevelDefinition } from '../../data/definitions/FacilityDefinition';

/** How far the company has built each facility: its level by facility id (absent or 0: not built). */
export type FacilityLevels = Readonly<Record<string, number>>;

/**
 * What the company's facilities give it, all together (FacilityDefinition's
 * effects): shares off prices and on top of pay and experience, and trucks
 * and contracts beyond the usual. No facilities: all 0.
 */
export type FacilityPerks = Readonly<Record<FacilityEffect, number>>;

export const NO_PERKS: FacilityPerks = Object.freeze({
  repairDiscount: 0,
  fuelDiscount: 0,
  garageSlots: 0,
  fleetPayBonus: 0,
  marketShareBonus: 0,
  xpBonus: 0,
  extraContracts: 0,
});

/** Where the services that facilities change read the company's perks as they stand. */
export interface PerkSource {
  readonly perks: FacilityPerks;
}

/** A source of no perks, for a company without facilities (and tests that need none). */
export const NO_PERK_SOURCE: PerkSource = Object.freeze({ perks: NO_PERKS });

/** A facility's level, clamped to what it has: an unknown or broken saved level counts as none built. */
export function facilityLevel(facility: FacilityDefinition, levels: FacilityLevels): number {
  const level = levels[facility.id];
  return typeof level === 'number' && Number.isInteger(level) && level > 0 ? Math.min(level, facility.levels.length) : 0;
}

/** The level a facility would be built to next, or null when it is at its top. */
export function nextFacilityLevel(facility: FacilityDefinition, level: number): FacilityLevelDefinition | null {
  return facility.levels[level] ?? null;
}

/** The perks of the facilities built to `levels`: each facility's effect at its level (levels replace, not add up). */
export function facilityPerks(facilities: readonly FacilityDefinition[], levels: FacilityLevels): FacilityPerks {
  const perks: Record<FacilityEffect, number> = { ...NO_PERKS };
  for (const facility of facilities) {
    const level = facilityLevel(facility, levels);
    if (level > 0) {
      perks[facility.effect] += facility.levels[level - 1]!.value;
    }
  }
  return perks;
}
