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
    bronze: {
      credits: [100, 100],
      paintChance: 0,
      rarityWeights: { rare: 1, epic: 1, legendary: 1 },
      partsChance: 1,
      parts: [2, 2],
      boosterChance: 1,
    },
    silver: {
      credits: [200, 200],
      paintChance: 1,
      rarityWeights: { rare: 1, epic: 0, legendary: 0 },
      partsChance: 0,
      parts: [1, 1],
      boosterChance: 0,
    },
    gold: {
      credits: [500, 500],
      paintChance: 1,
      rarityWeights: { rare: 1, epic: 1, legendary: 1 },
      partsChance: 0,
      parts: [1, 1],
      boosterChance: 0,
    },
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
  const supplied: [number, string | null][] = [];
  const supplies = { add: (parts: number, booster: string | null): void => void supplied.push([parts, booster]) };
  let nowMs = 1_000_000;
  const clock = { now: () => nowMs };
  const later = (hours: number): void => {
    nowMs += hours * 3_600_000;
  };
  const crates = new CrateService(CONFIG, content, economy, supplies, clock, () => 0.5, 7, events, logger);
  const earned: GameEvents['CrateEarned'][] = [];
  const opened: GameEvents['CrateOpened'][] = [];
  events.on('CrateEarned', (event) => earned.push(event));
  events.on('CrateOpened', (event) => opened.push(event));
  const deliver = (onTime: boolean, cargoDamage: number): void =>
    events.emit('MissionCompleted', { reward: { onTime }, cargoDamage } as unknown as GameEvents['MissionCompleted']);
  return { crates, economy, events, earned, opened, deliver, supplied, later };
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

  it('ends the streak when a contract fails, and gives a crate with each daily reward, a better one on its last day', () => {
    const { crates, events, earned, deliver } = setup();
    deliver(true, 0);
    events.emit('MissionFailed', {} as GameEvents['MissionFailed']);
    expect(crates.perfectStreak).toBe(0);
    expect(crates.lastDelivery).toBeNull();
    events.emit('DailyRewardClaimed', { day: 6, streak: 6, credits: 100 });
    events.emit('DailyRewardClaimed', { day: 7, streak: 7, credits: 100 });
    expect(earned).toEqual([
      { tier: 'bronze', source: 'daily' },
      { tier: 'silver', source: 'dailyStreak' },
    ]);
  });

  it('keeps a free crate waiting every few hours, one at a time, its tier drawn', () => {
    const { crates, earned, later } = setup();
    expect(crates.freeCrate.ready).toBe(true);
    // The roll of 0.5 falls on bronze (75 of 100).
    expect(crates.claimFreeCrate()).toEqual({ ok: true, value: 'bronze' });
    expect(crates.claimFreeCrate()).toEqual({ ok: false, error: 'notReady' });
    expect(crates.freeCrate.ready).toBe(false);
    later(DEFAULT_GAME_CONFIG.crates.freeCrateHours - 0.1);
    expect(crates.freeCrate.ready).toBe(false);
    later(0.2);
    expect(crates.freeCrate.ready).toBe(true);
    // Left waiting, it does not pile up.
    later(24);
    expect(crates.claimFreeCrate().ok).toBe(true);
    expect(crates.claimFreeCrate().ok).toBe(false);
    expect(earned).toEqual([
      { tier: 'bronze', source: 'free' },
      { tier: 'bronze', source: 'free' },
    ]);
    expect(crates.snapshot().freeCrateAtMs).toBe(crates.freeCrate.readyAtMs);
  });

  it('hands the parts and the booster a crate holds to the supplies', () => {
    const { crates, supplied } = setup();
    crates.grant('bronze', 'level');
    const opened = crates.open('bronze');
    expect(opened.ok && opened.value.parts).toBe(2);
    expect(opened.ok && opened.value.booster).not.toBeNull();
    expect(supplied).toEqual([[2, opened.ok ? opened.value.booster : null]]);
  });

  it('opens a crate for its credits and a crate colour not got yet, each given once', () => {
    const { crates, economy, opened } = setup();
    expect(crates.open('silver')).toEqual({ ok: false, error: 'noCrate' });
    crates.grant('silver', 'level');
    crates.grant('silver', 'level');
    expect(crates.total).toBe(2);

    expect(crates.open('silver')).toEqual({ ok: true, value: { credits: 200, paintId: 'test_aurora', liveryId: null, parts: 0, booster: null } });
    expect(crates.ownsCratePaint('test_aurora')).toBe(true);
    // The fixture's crate design is legendary: a silver crate, weighted to rare, gives the colour.
    expect(crates.paintsGot).toEqual({ got: 1, of: 2 });
    // Every colour got: credits alone.
    expect(crates.open('silver')).toEqual({ ok: true, value: { credits: 200, paintId: null, liveryId: null, parts: 0, booster: null } });
    expect(economy.credits).toBe(1400);
    expect(crates.opened).toBe(2);
    expect(crates.total).toBe(0);
    expect(opened).toEqual([
      { tier: 'silver', credits: 200, paintId: 'test_aurora', liveryId: null },
      { tier: 'silver', credits: 200, paintId: null, liveryId: null },
    ]);
  });

  it('saves the crates held, the colours given and the streaks, and takes them back', () => {
    const { crates, deliver } = setup();
    crates.grant('gold', 'level');
    crates.grant('bronze', 'perfectStreak');
    crates.open('bronze');
    deliver(true, 0);
    const saved = crates.snapshot();
    expect(saved).toEqual({ held: { gold: 1 }, opened: 1, paints: [], liveries: [], perfectStreak: 1, bestPerfectStreak: 1, freeCrateAtMs: 0 });

    const other = setup().crates;
    other.restore({ ...saved, paints: ['test_aurora', 'retired_colour'], held: { gold: 1, diamond: 4 } });
    expect(other.count('gold')).toBe(1);
    expect(other.total).toBe(1);
    expect(other.ownsCratePaint('test_aurora')).toBe(true);
    expect(other.snapshot().paints).toEqual(['test_aurora']);
    expect(other.perfectStreak).toBe(1);
  });
});
