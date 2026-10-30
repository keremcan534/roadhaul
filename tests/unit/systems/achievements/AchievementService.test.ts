import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { ContentCatalog } from '../../../../src/data/ContentCatalog';
import type { AchievementDefinition } from '../../../../src/data/definitions/AchievementDefinition';
import { AchievementService, type CompanyMeasures } from '../../../../src/systems/achievements/AchievementService';
import { EconomyService } from '../../../../src/systems/economy/EconomyService';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { contentFixture } from '../../../support/contentFixtures';
import { MemoryLogger } from '../../../support/MemoryLogger';

const GOALS: readonly AchievementDefinition[] = [
  { id: 'deliveries_2', metric: 'deliveries', target: 2, reward: 400 },
  { id: 'perfect_1', metric: 'perfectDeliveries', target: 1, reward: 300 },
  { id: 'distance_10', metric: 'distanceKm', target: 10, reward: 500 },
  { id: 'streak_3', metric: 'dailyStreak', target: 3, reward: 600 },
  { id: 'big_win_1', metric: 'bigWins', target: 1, reward: 700 },
];

function setup() {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const content = ContentCatalog.create(contentFixture({ achievements: [...GOALS] }));
  const economy = new EconomyService(events, DEFAULT_GAME_CONFIG.economy, logger);
  economy.restore(1000);
  let measures: CompanyMeasures = {
    deliveries: 0,
    distanceMeters: 0,
    companyLevel: 1,
    trucksOwned: 1,
    driversHired: 0,
    facilityLevels: 0,
    creditsEarned: 0,
    bestPerfectStreak: 0,
    cratesOpened: 0,
  };
  const goals = new AchievementService(content, economy, () => measures, events, logger);
  goals.restore({ counters: {}, claimed: [] });
  const reached: string[] = [];
  events.on('AchievementReached', ({ achievementId }) => reached.push(achievementId));
  const measure = (changes: Partial<CompanyMeasures>): void => {
    measures = { ...measures, ...changes };
  };
  const deliver = (cargoDamage: number): void =>
    events.emit('MissionCompleted', { cargoDamage, reward: { onTime: true } } as unknown as GameEvents['MissionCompleted']);
  return { goals, economy, events, reached, measure, deliver };
}

describe('AchievementService', () => {
  it('measures the company, announces each goal once as it is reached, and pays it once collected', () => {
    const { goals, economy, reached, measure, deliver } = setup();
    measure({ deliveries: 1 });
    deliver(0.2);
    expect(reached).toEqual([]);
    measure({ deliveries: 2 });
    deliver(0);
    expect(reached).toEqual(['deliveries_2', 'perfect_1']);
    deliver(0);
    expect(reached).toEqual(['deliveries_2', 'perfect_1']);
    expect(goals.claimable).toBe(2);

    expect(goals.claim('distance_10')).toEqual({ ok: false, error: 'notReached' });
    expect(goals.claim('deliveries_2')).toEqual({ ok: true, value: 400 });
    expect(goals.claim('deliveries_2')).toEqual({ ok: false, error: 'claimed' });
    expect(goals.claim('nonsense')).toEqual({ ok: false, error: 'unknownAchievement' });
    expect(economy.credits).toBe(1400);
    expect(goals.claimable).toBe(1);
    expect(goals.snapshot()).toEqual({ counters: { perfectDeliveries: 2 }, claimed: ['deliveries_2'] });
  });

  it('counts the longest daily streak, big wins at the slots and the kilometres driven', () => {
    const { goals, events, reached, measure } = setup();
    events.emit('DailyRewardClaimed', { day: 3, streak: 3, credits: 100 });
    events.emit('DailyRewardClaimed', { day: 1, streak: 1, credits: 100 });
    events.emit('SlotSpun', { bet: 50, payout: 100, kind: 'pair', multiplier: 2 });
    expect(reached).toEqual(['streak_3']);
    events.emit('SlotSpun', { bet: 50, payout: 1000, kind: 'three', multiplier: 20 });
    measure({ distanceMeters: 10_400 });
    events.emit('GameStateChanged', { previous: 'driving', current: 'mainMenu' } as GameEvents['GameStateChanged']);
    expect(reached).toEqual(['streak_3', 'big_win_1', 'distance_10']);
    expect(goals.list().find((goal) => goal.definition.id === 'distance_10')).toMatchObject({ progress: 10, reached: true });
    expect(goals.snapshot().counters).toEqual({ dailyStreak: 3, bigWins: 1 });
  });

  it('takes up a saved game without announcing what it had reached, and drops goals the game no longer has', () => {
    const { goals, reached, measure, deliver } = setup();
    measure({ deliveries: 5 });
    goals.restore({ counters: { perfectDeliveries: 1, luck: 9 }, claimed: ['perfect_1', 'retired_goal'] });
    deliver(0.5);
    expect(reached).toEqual([]);
    expect(goals.claimable).toBe(1);
    expect(goals.snapshot()).toEqual({ counters: { perfectDeliveries: 1 }, claimed: ['perfect_1'] });
  });
});
