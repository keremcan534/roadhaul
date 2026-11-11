import type { Validator } from '../../core/validation/Validator';
import { isCrateTier, type CrateTier } from './CrateTier';

/**
 * What a daily quest counts (QuestService), from the start of the player's day:
 *
 * - deliveries, perfectDeliveries, onTimeDeliveries: contracts delivered;
 *   with three stars; on time.
 * - distanceKm: kilometres driven.
 * - creditsEarned: credits paid by deliveries.
 * - refuels: fill-ups.
 * - tendersWon: tenders won against the rivals.
 */
export const QUEST_METRICS = [
  'deliveries',
  'perfectDeliveries',
  'onTimeDeliveries',
  'distanceKm',
  'creditsEarned',
  'refuels',
  'tendersWon',
] as const;
export type QuestMetric = (typeof QUEST_METRICS)[number];

/**
 * A daily quest: reach `target` of its metric in a day, then collect its
 * crate. Each day draws a few from the pool (dailyQuests). Its words come
 * from the string tables by metric (`quest.metric.<metric>`), the target as
 * a number.
 */
export interface QuestDefinition {
  /** Stable snake_case id. It is written into save files: never rename it. */
  readonly id: string;
  readonly metric: QuestMetric;
  readonly target: number;
  readonly crate: CrateTier;
}

export function validateQuestDefinition(quest: QuestDefinition, path: string, validator: Validator): void {
  validator.id(quest.id, `${path}.id`);
  validator.oneOf(quest.metric, QUEST_METRICS, `${path}.metric`);
  validator.positiveInteger(quest.target, `${path}.target`);
  validator.check(isCrateTier(quest.crate), `${path}.crate`, `unknown crate "${String(quest.crate)}"`);
}
