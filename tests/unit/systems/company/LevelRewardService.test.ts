import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { LevelRewardService } from '../../../../src/systems/company/LevelRewardService';
import { EconomyService } from '../../../../src/systems/economy/EconomyService';
import type { CrateSource, GameEvents } from '../../../../src/systems/GameEvents';
import type { CrateTier } from '../../../../src/data/config/GameConfig';
import { deliver, newCompany } from '../../../support/game';
import { MemoryLogger } from '../../../support/MemoryLogger';

function setup() {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const economy = new EconomyService(events, DEFAULT_GAME_CONFIG.economy, logger);
  economy.restore(0);
  const company = { level: 1 };
  const granted: [CrateTier, CrateSource][] = [];
  const crates = { grant: (tier: CrateTier, source: CrateSource): void => void granted.push([tier, source]) };
  const rewards = [
    { credits: 100, crate: 'bronze' as const },
    { credits: 200, crate: 'silver' as const },
    { credits: 300, crate: 'gold' as const },
  ];
  const levels = new LevelRewardService(rewards, company, economy, crates, events, logger);
  const collected: GameEvents['LevelRewardCollected'][] = [];
  events.on('LevelRewardCollected', (event) => collected.push(event));
  return { levels, economy, company, granted, collected };
}

describe('LevelRewardService', () => {
  it('keeps each level\'s reward waiting until collected, the lowest first', () => {
    const { levels, economy, company, granted, collected } = setup();
    expect(levels.waitingLevel).toBeNull();
    expect(levels.collect()).toEqual({ ok: false, error: 'nothingWaiting' });

    company.level = 3;
    expect(levels.waiting).toBe(2);
    expect(levels.waitingLevel).toBe(2);
    expect(levels.collect()).toEqual({ ok: true, value: { level: 2, credits: 100, crate: 'bronze' } });
    expect(levels.waitingLevel).toBe(3);
    expect(levels.collect()).toEqual({ ok: true, value: { level: 3, credits: 200, crate: 'silver' } });
    expect(levels.waitingLevel).toBeNull();

    expect(economy.credits).toBe(300);
    expect(granted).toEqual([
      ['bronze', 'level'],
      ['silver', 'level'],
    ]);
    expect(collected).toEqual([
      { level: 2, credits: 100, crate: 'bronze' },
      { level: 3, credits: 200, crate: 'silver' },
    ]);
    expect(levels.snapshot()).toEqual({ rewardedLevel: 3 });
  });

  it('takes up the levels collected from a save: those above wait', () => {
    const { levels, company } = setup();
    company.level = 4;
    levels.restore({ rewardedLevel: 3 });
    expect(levels.waitingLevel).toBe(4);
    expect(levels.rewardFor(4)).toEqual({ credits: 300, crate: 'gold' });
    expect(() => levels.rewardFor(5)).toThrow();
  });

  it('in the game: a level reached waits for the player, pays and gives its crate once collected, and is saved', async () => {
    const game = await newCompany(1, 0);
    game.company.award(DEFAULT_GAME_CONFIG.company.levelXp[1]!);
    expect(game.levelRewards.waitingLevel).toBe(2);

    const reward = DEFAULT_GAME_CONFIG.company.levelRewards[0]!;
    expect(game.levelRewards.collect()).toEqual({ ok: true, value: { level: 2, ...reward } });
    expect(game.economy.credits).toBe(reward.credits);
    expect(game.crates.count(reward.crate)).toBe(1);
    expect(game.session.snapshot().levelRewards).toEqual({ rewardedLevel: 2 });
  });

  it('in the game: a delivery on time with its cargo whole earns three stars and starts the perfect streak', async () => {
    const game = await newCompany(1, 0);
    deliver(game, 'first_package');
    expect(game.crates.lastDelivery).toMatchObject({ stars: { onTime: true, flawless: true, count: 3 }, streak: 1 });
    expect(game.session.snapshot().crates.perfectStreak).toBe(1);
  });
});
