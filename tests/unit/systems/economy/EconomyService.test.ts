import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { calculateMissionReward } from '../../../../src/domain/missions/missionReward';
import { EconomyService } from '../../../../src/systems/economy/EconomyService';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { missionFixture } from '../../../support/contentFixtures';
import { MemoryLogger } from '../../../support/MemoryLogger';

function setup() {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const changes: GameEvents['MoneyChanged'][] = [];
  events.on('MoneyChanged', (change) => changes.push(change));
  const economy = new EconomyService(events, { fuelPricePerLiter: 12, roadsideFuelPriceFactor: 2, fullRepairCost: 6000 }, logger);
  economy.restore(1000);
  return { events, economy, changes };
}

describe('EconomyService', () => {
  it('starts from the restored balance without announcing it', () => {
    const { economy, changes } = setup();

    expect(economy.credits).toBe(1000);
    expect(changes).toEqual([]);
  });

  it('earns and spends, announcing every change', () => {
    const { economy, changes } = setup();

    economy.earn(500, 'delivery');
    expect(economy.spend(300, 'fuel')).toEqual({ ok: true, value: 1200 });

    expect(changes).toEqual([
      { balance: 1500, change: 500, reason: 'delivery' },
      { balance: 1200, change: -300, reason: 'fuel' },
    ]);
  });

  it('refuses what the company cannot afford, changing nothing', () => {
    const { economy, changes } = setup();

    expect(economy.canAfford(1001)).toBe(false);
    expect(economy.spend(1001, 'repair')).toEqual({ ok: false, error: 'insufficientFunds' });
    expect(economy.credits).toBe(1000);
    expect(changes).toEqual([]);
  });

  it('pays the reward of every delivery (spec §13)', () => {
    const { events, economy } = setup();
    const reward = calculateMissionReward({
      baseReward: 900,
      cargoRewardMultiplier: 1,
      timeSensitivity: 0.5,
      timeLimitSeconds: 120,
      deliverySeconds: 60,
      cargoDamage: 0,
      damageTolerance: 0.3,
    });

    events.emit('MissionCompleted', {
      missionId: 'm',
      mission: missionFixture({ id: 'm' }),
      reward,
      deliverySeconds: 60,
      cargoDamage: 0,
      xp: 100,
      reputation: 10,
    });

    expect(economy.credits).toBe(1000 + reward.total);
  });

  it('prices fuel at the pump and on the road, and repairs by damage', () => {
    const { economy } = setup();

    expect(economy.fuelCost(10)).toBe(120);
    expect(economy.fuelCost(10, true)).toBe(240);
    expect(economy.litersAffordable(100)).toBe(8);
    expect(economy.litersAffordable(100, true)).toBe(4);
    expect(economy.repairCost(0.25)).toBe(1500);
  });

  it('stops listening when disposed', () => {
    const { events, economy } = setup();

    economy.dispose();

    expect(events.listenerCount('MissionCompleted')).toBe(0);
  });

  it('uses the default prices from the config', () => {
    expect(DEFAULT_GAME_CONFIG.economy.fuelPricePerLiter).toBeGreaterThan(0);
  });
});
