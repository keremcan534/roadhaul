import type { ContentCatalog } from '../../data/ContentCatalog';

/** What a new level unlocks, as a chip (LevelUpDialog): what it is, and how many. */
export interface LevelUnlockShown {
  readonly kind: LevelUnlockKind;
  readonly count: number;
}

export const LEVEL_UNLOCK_KINDS = ['regions', 'vehicles', 'upgrades', 'missions', 'paints', 'facilities', 'drivers', 'events'] as const;
export type LevelUnlockKind = (typeof LEVEL_UNLOCK_KINDS)[number];

/** What company level `level` opens up, from the content's level requirements: each kind with any, and how many (a new region first). */
export function levelUnlocks(content: ContentCatalog, level: number): LevelUnlockShown[] {
  const at = (required: number | undefined): boolean => (required ?? 1) === level;
  // A region opens when a crossing to it does (MapDefinition.gates): each region once, whichever way.
  const regions = new Set(
    content.maps.all.flatMap((map) => (map.gates ?? []).filter((gate) => at(gate.requiredCompanyLevel) && gate.requiredCompanyLevel !== undefined).map((gate) => gate.toMapId)),
  );
  const counts: readonly (readonly [LevelUnlockKind, number])[] = [
    ['regions', regions.size],
    ['vehicles', content.vehicles.all.filter((vehicle) => at(vehicle.requiredCompanyLevel)).length],
    [
      'upgrades',
      content.upgrades.all.reduce((sum, upgrade) => sum + upgrade.levels.filter((step) => at(step.requiredCompanyLevel)).length, 0),
    ],
    ['missions', content.missions.all.filter((mission) => at(mission.requiredCompanyLevel)).length],
    ['paints', content.paints.all.filter((paint) => paint.premium !== true && at(paint.requiredCompanyLevel)).length],
    [
      'facilities',
      content.facilities.all.reduce((sum, facility) => sum + facility.levels.filter((step) => at(step.requiredCompanyLevel)).length, 0),
    ],
    ['drivers', content.drivers.all.filter((driver) => at(driver.requiredCompanyLevel)).length],
    ['events', content.events.all.filter((event) => at(event.requiredCompanyLevel)).length],
  ];
  return counts.filter(([, count]) => count > 0).map(([kind, count]) => ({ kind, count }));
}
