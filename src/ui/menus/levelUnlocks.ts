import type { ContentCatalog } from '../../data/ContentCatalog';
import type { LevelUnlockKind, LevelUnlockShown } from './LevelUpDialog';

/** What company level `level` opens up, from the content's level requirements: each kind with any, and how many. */
export function levelUnlocks(content: ContentCatalog, level: number): LevelUnlockShown[] {
  const at = (required: number | undefined): boolean => (required ?? 1) === level;
  const counts: readonly (readonly [LevelUnlockKind, number])[] = [
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
