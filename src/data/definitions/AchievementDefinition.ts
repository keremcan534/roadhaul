import type { Validator } from '../../core/validation/Validator';
import type { Credits } from '../units';

/**
 * What a goal counts (AchievementService keeps or reads it):
 *
 * - deliveries, perfectDeliveries: contracts delivered; with the cargo
 *   undamaged.
 * - distanceKm: kilometres the company's trucks were driven by the player.
 * - companyLevel, trucksOwned, driversHired, facilityLevels: how far the
 *   company has grown (its level, its garage, its drivers, the levels of
 *   its facilities added up).
 * - creditsEarned: credits earned from deliveries.
 * - tendersWon, rivalsBoughtOut: beating the rivals.
 * - dailyStreak: the longest run of days the daily reward was collected.
 * - upgradesFitted: upgrade levels bought.
 * - bigWins: the slot machine paying ten times the bet or more.
 */
export const ACHIEVEMENT_METRICS = [
  'deliveries',
  'perfectDeliveries',
  'distanceKm',
  'companyLevel',
  'trucksOwned',
  'driversHired',
  'facilityLevels',
  'creditsEarned',
  'tendersWon',
  'rivalsBoughtOut',
  'dailyStreak',
  'upgradesFitted',
  'bigWins',
] as const;
export type AchievementMetric = (typeof ACHIEVEMENT_METRICS)[number];

/**
 * A goal for the company: reach `target` of its metric, then collect its
 * reward. Its words come from the string tables by metric
 * (`achievement.metric.<metric>`), with the target as a number.
 */
export interface AchievementDefinition {
  /** Stable snake_case id. It is written into save files: never rename it. */
  readonly id: string;
  readonly metric: AchievementMetric;
  readonly target: number;
  readonly reward: Credits;
}

export function validateAchievementDefinition(achievement: AchievementDefinition, path: string, validator: Validator): void {
  validator.id(achievement.id, `${path}.id`);
  validator.oneOf(achievement.metric, ACHIEVEMENT_METRICS, `${path}.metric`);
  validator.positiveInteger(achievement.target, `${path}.target`);
  validator.positiveInteger(achievement.reward, `${path}.reward`);
}
