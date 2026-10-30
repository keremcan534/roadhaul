import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { ContentCatalog } from '../../../../src/data/ContentCatalog';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { EconomyService } from '../../../../src/systems/economy/EconomyService';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { CrateService } from '../../../../src/systems/rewards/CrateService';
import { contentFixture, paintFixture } from '../../../support/contentFixtures';
import { MemoryLogger } from '../../../support/MemoryLogger';

const CONFIG = {
  ...DEFAULT_GAME_CONFIG.crates,
  tiers: {
    bronze: { credits: [100, 100], paintChance: 0, rarityWeights: { rare: 1, epic: 1, legendary: 1 } },
    silver: { credits: [200, 200], paintChance: 1, rarityWeights: { rare: 1, epic: 0, legendary: 0 } },
    gold: { credits: [500, 500], paintChance: 1, rarityWeights: { rare: 1, epic: 1, legendary: 1 } },
  },
} as const;

function setup() {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const content = ContentCatalog.create(
    contentFixture({ paints: [paintFixture(), paintFixture({ id: 'test_aurora', color: 0x2ee6a0, price: 0, crate: 'rare' })] }),
  );
  const economy = new EconomyService(events, DEFAULT_GAME_CONFIG.economy, logger);
  economy.restore(1000);
  const crates = new CrateService(CONFIG, content, economy, () => 0.5, 7, events, logger);
  const earned: GameEvents['CrateEarned'][] = [];
  const opened: GameEvents['CrateOpened'][] = [];
  events.on('CrateEarned', (event) => earned.push(event));
  events.on('CrateOpened', (event) => opened.push(event));
  const deliver = (onTime: boolean, cargoDamage: number): void =>
    events.emit('MissionCompleted', { reward: { onTime }, cargoDamage } as unknown as GameEvents['MissionCompleted']);
  return { crates, economy, events, earned, opened, deliver };
}

describe('CrateService', () => {
  it('keeps the perfect streak, celebrating each delivery, and gives a crate on every third', () => {
    const { crates, earned, deliver } = setup();
    deliver(true, 0);
    deliver(true, 0);
    expect(crates.lastDelivery).toMatchObject({ streak: 2, crate: null, next: { deliveries: 1, tier: 'bronze' } });
    deliver(true, 0);
    expect(crates.lastDelivery).toMatchObject({ stars: { count: 3 }, streak: 3, best: 3, crate: 'bronze' });
    expect(earned).toEqual([{ tier: 'bronze', source: 'perfectStreak' }]);
    expect(crates.count('bronze')).toBe(1);

    // Late breaks it; the best stays.
    deliver(false, 0);
    expect(crates.lastDelivery).toMatchObject({ stars: { count: 2 }, streak: 0, best: 3, crate: null });
    expect(crates.perfectStreak).toBe(0);
    expect(crates.bestPerfectStreak).toBe(3);
  });

  it('ends the streak when a contract fails, and gives a crate with the daily reward\'s last day', () => {
    const { crates, events, earned, deliver } = setup();
    deliver(true, 0);
    events.emit('MissionFailed', {} as GameEvents['MissionFailed']);
    expect(crates.perfectStreak).toBe(0);
    expect(crates.lastDelivery).toBeNull();
    events.emit('DailyRewardClaimed', { day: 6, streak: 6, credits: 100 });
    events.emit('DailyRewardClaimed', { day: 7, streak: 7, credits: 100 });
    expect(earned).toEqual([{ tier: 'silver', source: 'dailyStreak' }]);
  });

  it('opens a crate for its credits and a crate colour not got yet, each given once', () => {
    const { crates, economy, opened } = setup();
    expect(crates.open('silver')).toEqual({ ok: false, error: 'noCrate' });
    crates.grant('silver', 'level');
    crates.grant('silver', 'level');
    expect(crates.total).toBe(2);

    expect(crates.open('silver')).toEqual({ ok: true, value: { credits: 200, paintId: 'test_aurora' } });
    expect(crates.ownsCratePaint('test_aurora')).toBe(true);
    expect(crates.paintsGot).toEqual({ got: 1, of: 1 });
    // Every colour got: credits alone.
    expect(crates.open('silver')).toEqual({ ok: true, value: { credits: 200, paintId: null } });
    expect(economy.credits).toBe(1400);
    expect(crates.opened).toBe(2);
    expect(crates.total).toBe(0);
    expect(opened).toEqual([
      { tier: 'silver', credits: 200, paintId: 'test_aurora' },
      { tier: 'silver', credits: 200, paintId: null },
    ]);
  });

  it('saves the crates held, the colours given and the streaks, and takes them back', () => {
    const { crates, deliver } = setup();
    crates.grant('gold', 'level');
    crates.grant('bronze', 'perfectStreak');
    crates.open('bronze');
    deliver(true, 0);
    const saved = crates.snapshot();
    expect(saved).toEqual({ held: { gold: 1 }, opened: 1, paints: [], perfectStreak: 1, bestPerfectStreak: 1 });

    const other = setup().crates;
    other.restore({ ...saved, paints: ['test_aurora', 'retired_colour'], held: { gold: 1, diamond: 4 } });
    expect(other.count('gold')).toBe(1);
    expect(other.total).toBe(1);
    expect(other.ownsCratePaint('test_aurora')).toBe(true);
    expect(other.snapshot().paints).toEqual(['test_aurora']);
    expect(other.perfectStreak).toBe(1);
  });
});
