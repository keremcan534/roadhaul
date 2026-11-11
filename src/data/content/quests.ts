import type { QuestDefinition } from '../definitions/QuestDefinition';

/** The daily quests' pool: each day draws three of different metrics (dailyQuests). */
export const QUESTS: readonly QuestDefinition[] = [
  { id: 'deliver_2', metric: 'deliveries', target: 2, crate: 'bronze' },
  { id: 'deliver_4', metric: 'deliveries', target: 4, crate: 'silver' },
  { id: 'perfect_1', metric: 'perfectDeliveries', target: 1, crate: 'bronze' },
  { id: 'perfect_3', metric: 'perfectDeliveries', target: 3, crate: 'silver' },
  { id: 'on_time_3', metric: 'onTimeDeliveries', target: 3, crate: 'bronze' },
  { id: 'drive_15', metric: 'distanceKm', target: 15, crate: 'bronze' },
  { id: 'drive_40', metric: 'distanceKm', target: 40, crate: 'silver' },
  { id: 'earn_5000', metric: 'creditsEarned', target: 5000, crate: 'bronze' },
  { id: 'earn_15000', metric: 'creditsEarned', target: 15_000, crate: 'silver' },
  { id: 'refuel_1', metric: 'refuels', target: 1, crate: 'bronze' },
  { id: 'tender_1', metric: 'tendersWon', target: 1, crate: 'silver' },
];
