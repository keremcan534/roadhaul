import { SeededRandom } from '../../core/random/SeededRandom';
import type { QuestDefinition } from '../../data/definitions/QuestDefinition';

/** How many quests a day brings. */
export const QUESTS_PER_DAY = 3;

/**
 * The quests of the player's day `day` (localDay): `count` drawn from
 * `pool`, each of a different metric while the pool has enough of them,
 * the same ones all day on every device.
 */
export function dailyQuests(pool: readonly QuestDefinition[], day: number, count = QUESTS_PER_DAY): QuestDefinition[] {
  const random = new SeededRandom(Math.imul(day + 1, 0x2c1b3c6d) ^ 0x51ed27);
  const left = [...pool];
  const chosen: QuestDefinition[] = [];
  while (chosen.length < count && left.length > 0) {
    // Another metric than those chosen, while there is one.
    const fresh = left.filter((quest) => !chosen.some((other) => other.metric === quest.metric));
    const from = fresh.length > 0 ? fresh : left;
    const quest = from[Math.min(from.length - 1, Math.floor(random.next() * from.length))]!;
    chosen.push(quest);
    left.splice(left.indexOf(quest), 1);
  }
  return chosen;
}
