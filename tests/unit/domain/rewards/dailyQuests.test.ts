import { describe, expect, it } from 'vitest';
import { QUESTS } from '../../../../src/data/content/quests';
import { dailyQuests, QUESTS_PER_DAY } from '../../../../src/domain/rewards/dailyQuests';

describe('dailyQuests', () => {
  it('draws three quests of different metrics for a day, the same ones every time', () => {
    for (let day = 20_000; day < 20_060; day++) {
      const quests = dailyQuests(QUESTS, day);
      expect(quests).toHaveLength(QUESTS_PER_DAY);
      expect(new Set(quests.map((quest) => quest.metric)).size).toBe(QUESTS_PER_DAY);
      expect(dailyQuests(QUESTS, day)).toEqual(quests);
    }
  });

  it('changes them from day to day, and uses the whole pool over a month', () => {
    const seen = new Set<string>();
    let changed = 0;
    for (let day = 20_000; day < 20_030; day++) {
      const ids = dailyQuests(QUESTS, day).map((quest) => quest.id);
      ids.forEach((id) => seen.add(id));
      if (ids.join() !== dailyQuests(QUESTS, day + 1).map((quest) => quest.id).join()) {
        changed++;
      }
    }
    expect(changed).toBeGreaterThan(25);
    expect(seen.size).toBe(QUESTS.length);
  });

  it('takes what there is from a small pool', () => {
    expect(dailyQuests(QUESTS.slice(0, 2), 5)).toHaveLength(2);
    expect(dailyQuests([], 5)).toEqual([]);
  });
});
