import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../../../../src/core/storage/KeyValueStorage';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { UPGRADES } from '../../../../src/data/content/upgrades';
import { VEHICLES } from '../../../../src/data/content/vehicles';
import { SALE_DAMAGE_LOSS, SALE_SHARE, SALE_UPGRADE_SHARE } from '../../../../src/systems/vehicles/GarageService';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { bootGame, newCompany, type Game } from '../../../support/game';

const USED = DEFAULT_GAME_CONFIG.usedTrucks;
const HOURS = USED.refreshHours * 3_600_000;

function listen<K extends keyof GameEvents>(game: Game, name: K): GameEvents[K][] {
  const heard: GameEvents[K][] = [];
  game.events.on(name, (event) => heard.push(event));
  return heard;
}

describe('selling trucks', () => {
  it('sells a truck in the garage for a share of its price, less for its wear, more for its upgrades', async () => {
    const game = await newCompany(4, 200_000);
    const h4 = VEHICLES.find((vehicle) => vehicle.id === 'rh_h4')!;
    game.garage.buy(h4.id);
    game.garage.wearTruck('truck_002', 0.4);
    const sold = listen(game, 'VehicleSold');
    const credits = game.economy.credits;

    const expected = Math.round((h4.purchasePrice * SALE_SHARE * (1 - SALE_DAMAGE_LOSS * 0.4)) / 100) * 100;
    expect(game.garage.saleValue('truck_002')).toBe(expected);
    expect(game.garage.sell('truck_002')).toEqual({ ok: true, value: expected });
    expect(game.economy.credits).toBe(credits + expected);
    expect(game.garage.trucks.map((truck) => truck.instanceId)).toEqual(['truck_001']);
    expect(sold).toEqual([{ instanceId: 'truck_002', definitionId: h4.id, price: expected }]);
  });

  it('counts a share of what the upgrades cost', async () => {
    const game = await newCompany(4, 200_000);
    game.garage.buy('rh_h1');
    const upgrade = UPGRADES[0]!;
    game.garage.switchTo('truck_002');
    game.garage.fitUpgrade(upgrade.id, 2);
    game.garage.switchTo('truck_001');
    const h1 = VEHICLES[0]!;
    const upgrades = upgrade.levels[0]!.cost + upgrade.levels[1]!.cost;

    expect(game.garage.saleValue('truck_002')).toBe(Math.round((h1.purchasePrice * SALE_SHARE + upgrades * SALE_UPGRADE_SHARE) / 100) * 100);
  });

  it('never sells the truck being driven, nor one a hired driver has out', async () => {
    const game = await newCompany(1, 100_000);
    game.garage.buy('rh_h1');
    game.garage.assignDriver('truck_002', 'driver_kemal');

    expect(game.garage.sell('truck_001')).toEqual({ ok: false, error: 'activeTruck' });
    expect(game.garage.sell('truck_002')).toEqual({ ok: false, error: 'onTheRoad' });
    expect(game.garage.sell('truck_009')).toEqual({ ok: false, error: 'unknownTruck' });
    expect(game.garage.trucks).toHaveLength(2);
  });

  it('forgets a sold truck\'s design: one bought later under its number starts in the classic', async () => {
    const game = await newCompany(1, 100_000);
    game.garage.buy('rh_h1');
    game.liveries.restore({ bought: ['speed'], worn: { truck_002: 'speed' }, text: null });

    game.garage.sell('truck_002');

    expect(game.liveries.snapshot().worn).toEqual({});
  });
});

describe('UsedTruckMarket', () => {
  it('lists a few used trucks of the models the company may buy, cheaper than new and worn, the same all through a period', async () => {
    const game = await newCompany(4, 200_000);
    const offers = game.usedTrucks.offers();

    expect(offers).toHaveLength(USED.offers);
    for (const offer of offers) {
      expect(offer.definition.requiredCompanyLevel ?? 1).toBeLessThanOrEqual(4);
      expect(offer.price).toBeLessThanOrEqual(Math.round((offer.newPrice * (1 - USED.discount[0])) / 100) * 100);
      expect(offer.price).toBeGreaterThanOrEqual(Math.round((offer.newPrice * (1 - USED.discount[1])) / 100) * 100);
      expect(offer.damage).toBeGreaterThanOrEqual(USED.damage[0]);
      expect(offer.damage).toBeLessThanOrEqual(USED.damage[1]);
      expect(offer.sold).toBe(false);
    }
    expect(game.usedTrucks.offers()).toEqual(offers);
  });

  it('sells one into the garage in its wear, colour and upgrades, then shows it sold until the next list', async () => {
    const game = await newCompany(4, 200_000);
    const offer = game.usedTrucks.offers()[1]!;
    const credits = game.economy.credits;

    let soldWhenTold = false;
    game.events.on('VehiclePurchased', () => (soldWhenTold = game.usedTrucks.offers()[1]!.sold));
    const bought = game.usedTrucks.buy(1);
    expect(soldWhenTold).toBe(true); // The panel, redrawn as the garage tells of the truck, sees it sold.

    expect(bought.ok).toBe(true);
    expect(game.economy.credits).toBe(credits - offer.price);
    const truck = game.garage.trucks[1]!;
    expect(truck).toMatchObject({ definition: offer.definition, damage: offer.damage, upgrades: offer.upgrades, active: false });
    expect(truck.paint?.id ?? null).toBe(offer.paintId);
    expect(truck.fuelLiters).toBe(offer.definition.fuelCapacityLiters);
    expect(game.usedTrucks.offers()[1]!.sold).toBe(true);
    expect(game.usedTrucks.buy(1)).toEqual({ ok: false, error: 'sold' });
    expect(game.usedTrucks.buy(7)).toEqual({ ok: false, error: 'unknownOffer' });
  });

  it('never pays to buy a used truck and sell it again', async () => {
    const game = await newCompany(10, 10_000_000);
    for (let period = 0; period < 40; period++) {
      for (const offer of listAt(game, period)) {
        // What it would fetch sold at once: the same sum GarageService.saleValue makes.
        const upgrades = Object.entries(offer.upgrades).reduce(
          (sum, [id, level]) => sum + UPGRADES.find((upgrade) => upgrade.id === id)!.levels.slice(0, level).reduce((paid, step) => paid + step.cost, 0),
          0,
        );
        const sale = Math.round((offer.definition.purchasePrice * SALE_SHARE * (1 - SALE_DAMAGE_LOSS * offer.damage) + upgrades * SALE_UPGRADE_SHARE) / 100) * 100;
        expect(sale).toBeLessThan(offer.price);
      }
    }
  });

  it('refuses one the garage has no room for, or the company cannot pay for', async () => {
    const poor = await newCompany(4, 100);
    expect(poor.usedTrucks.buy(0)).toEqual({ ok: false, error: 'insufficientFunds' });
    expect(poor.usedTrucks.offers()[0]!.sold).toBe(false);
    const full = await newCompany(1, 1_000_000);
    while (full.garage.hasRoom) {
      full.garage.buy('rh_h1');
    }
    expect(full.usedTrucks.buy(0)).toEqual({ ok: false, error: 'garageFull' });
  });

  it('keeps what was bought in the save for the period; the next list has them all', async () => {
    const storage = new MemoryStorage();
    const first = await bootGame(storage, 1_000);
    first.session.startNewGame('Kuzey Lojistik');
    first.economy.restore(500_000);
    first.usedTrucks.buy(0);
    first.session.save();

    const second = await bootGame(storage, 2_000);
    second.session.continueGame();
    expect(second.usedTrucks.offers()[0]!.sold).toBe(true);

    const later = await bootGame(storage, 1_000 + HOURS);
    later.session.continueGame();
    expect(later.usedTrucks.offers().every((offer) => !offer.sold)).toBe(true);
  });
});

/** The list of period `period`, as a game at that time sees it. */
function listAt(game: Game, period: number) {
  const market = game.usedTrucks as unknown as { listFor(period: number): ReturnType<Game['usedTrucks']['offers']> };
  return market.listFor(period);
}
