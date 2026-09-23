import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { input, kmh, STEP_SECONDS } from '../../../support/driving';
import { bootGame, newCompany, parkInTargetBay, play, type Game } from '../../../support/game';

/** Seconds from a standstill to 50 km/h at full throttle, from where the truck stands. */
function timeTo50(game: Game): number {
  let elapsed = 0;
  while (kmh(game.driving.vehicle) < 50 && elapsed < 60) {
    game.driving.step(STEP_SECONDS, input({ throttle: 1 }));
    elapsed += STEP_SECONDS;
  }
  return elapsed;
}

describe('UpgradeService', () => {
  it('offers the first level of every upgrade, locking those above the company level', async () => {
    const game = await newCompany();

    expect(
      game.upgrades.offers().map(({ upgrade, fittedLevel, next }) => [upgrade.id, fittedLevel, next?.cost, next?.locked]),
    ).toEqual([
      ['engine', 0, 3000, false],
      ['brakes', 0, 2000, false],
      ['tires', 0, 2500, false],
      ['suspension', 0, 3000, true],
      ['fuel_tank', 0, 1500, false],
    ]);
  });

  it('sells one level at a time, fitting it to the active truck', async () => {
    const game = await newCompany(2, 10_000);
    const purchases: GameEvents['UpgradePurchased'][] = [];
    game.events.on('UpgradePurchased', (event) => purchases.push(event));

    expect(game.upgrades.buy('brakes')).toEqual({ ok: true, value: 1 });
    expect(game.upgrades.buy('brakes')).toEqual({ ok: true, value: 2 });

    expect(game.economy.credits).toBe(4000);
    expect(game.garage.fittedLevel('brakes')).toBe(2);
    expect(purchases).toEqual([
      { instanceId: 'truck_001', upgradeId: 'brakes', level: 1, cost: 2000 },
      { instanceId: 'truck_001', upgradeId: 'brakes', level: 2, cost: 4000 },
    ]);
    const offer = game.upgrades.offers().find((candidate) => candidate.upgrade.id === 'brakes')!;
    expect(offer).toMatchObject({ fittedLevel: 2, next: { level: 3, cost: 7000, requiredCompanyLevel: 3, locked: true } });
    expect(offer.fittedModifiers).toEqual([{ stat: 'brakingPower', bonus: 0.2 }]);
  });

  it('refuses locked, topped-out, unknown and unaffordable upgrades without charging', async () => {
    const game = await newCompany(4, 100_000);
    for (let level = 1; level <= 3; level++) {
      game.upgrades.buy('fuel_tank');
    }
    const credits = game.economy.credits;

    expect(game.upgrades.buy('fuel_tank')).toEqual({ ok: false, error: 'maxLevel' });
    expect(game.upgrades.offers().find((offer) => offer.upgrade.id === 'fuel_tank')!.next).toBeNull();
    expect(game.upgrades.buy('turbo')).toEqual({ ok: false, error: 'unknownUpgrade' });
    expect(game.economy.credits).toBe(credits);

    const beginner = await newCompany(1, 100_000);
    expect(beginner.upgrades.buy('suspension')).toEqual({ ok: false, error: 'locked' });
    const broke = await newCompany(1, 1000);
    expect(broke.upgrades.buy('engine')).toEqual({ ok: false, error: 'insufficientFunds' });
    expect(broke.garage.fittedLevel('engine')).toBe(0);
  });

  it('makes an upgraded engine pull away faster (spec §58: upgrade → stat change)', async () => {
    const stock = await newCompany(3);
    const tuned = await newCompany(3);
    for (let level = 1; level <= 3; level++) {
      tuned.upgrades.buy('engine');
    }

    expect(timeTo50(tuned)).toBeLessThan(timeTo50(stock) * 0.9);
  });

  it('lets a bigger tank take more fuel', async () => {
    const game = await newCompany();
    game.upgrades.buy('fuel_tank');

    expect(game.fuel.capacityLiters).toBe(180);
    expect(game.fuel.fraction).toBeCloseTo(150 / 180, 12);
    expect(game.fuel.refuel()).toMatchObject({ ok: true, value: { liters: 30 } });
  });

  it('protects the cargo with an upgraded suspension', async () => {
    const hits = async (withSuspension: boolean): Promise<number> => {
      const game = await newCompany(2);
      if (withSuspension) {
        game.upgrades.buy('suspension');
      }
      game.missions.accept('first_package');
      play(game, STEP_SECONDS);
      parkInTargetBay(game);
      play(game, DEFAULT_GAME_CONFIG.missions.loadingSeconds + 0.1);
      game.events.emit('VehicleCollided', { impactSpeedMetersPerSecond: 6 });
      return game.missions.active!.cargoDamage;
    };

    expect(await hits(true)).toBeCloseTo((await hits(false)) * 0.85, 9);
  });

  it('keeps upgrades in the save and fits them again on continue', async () => {
    const first = await newCompany(2);
    first.upgrades.buy('engine');
    first.upgrades.buy('fuel_tank');

    const second = await bootGame(first.storage, 2_000);
    second.session.continueGame();

    expect(second.garage.fittedLevel('engine')).toBe(1);
    expect(second.garage.fittedLevel('fuel_tank')).toBe(1);
    expect(second.fuel.capacityLiters).toBe(180);
    expect(second.garage.activeBonuses.enginePower).toBeCloseTo(0.08, 12);
  });
});
