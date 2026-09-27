import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../../../../src/core/storage/KeyValueStorage';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { FACILITIES } from '../../../../src/data/content/facilities';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { bootGame, deliver, newCompany, reachLevel, type Game } from '../../../support/game';

function listen<K extends keyof GameEvents>(game: Game, name: K): GameEvents[K][] {
  const heard: GameEvents[K][] = [];
  game.events.on(name, (event) => heard.push(event));
  return heard;
}

/** What each level of `facilityId` costs, lowest first. */
function costs(facilityId: string): number[] {
  return FACILITIES.find((facility) => facility.id === facilityId)!.levels.map((level) => level.cost);
}

/** A company at `level` with plenty of money, and `facilityIds` built to their first level. */
async function companyWith(facilityIds: readonly string[], level = 5): Promise<Game> {
  const game = await newCompany(level, 500_000);
  for (const facilityId of facilityIds) {
    const built = game.facilities.build(facilityId);
    if (!built.ok) {
      throw new Error(`Cannot build ${facilityId}: ${built.error}.`);
    }
  }
  return game;
}

describe('FacilityService', () => {
  it('offers every facility unbuilt, the first level of each, locking those above the company level', async () => {
    const game = await newCompany(1, 5000);
    const offers = game.facilities.offers();

    expect(offers.map((offer) => offer.definition.id)).toEqual(FACILITIES.map((facility) => facility.id));
    for (const offer of offers) {
      expect(offer.level, offer.definition.id).toBe(0);
      expect(offer.next, offer.definition.id).toBe(offer.definition.levels[0]);
      expect(offer.locked, offer.definition.id).toBe((offer.definition.levels[0]!.requiredCompanyLevel ?? 1) > 1);
    }
    expect(offers.filter((offer) => !offer.locked).map((offer) => offer.definition.id)).toEqual([
      'workshop',
      'fuel_depot',
      'training_centre',
      'logistics_office',
    ]);
  });

  it('builds one level at a time, charging for each and telling the game', async () => {
    const game = await newCompany(1, 20_000);
    const built = listen(game, 'FacilityBuilt');
    const money = listen(game, 'MoneyChanged');
    const [first, second] = costs('workshop');

    expect(game.facilities.build('workshop')).toEqual({ ok: true, value: 1 });
    expect(game.economy.credits).toBe(20_000 - first!);
    expect(game.facilities.levelOf('workshop')).toBe(1);
    expect(built).toEqual([{ facilityId: 'workshop', level: 1, cost: first }]);
    expect(money.at(-1)).toMatchObject({ reason: 'facility', change: -first! });
    const offer = game.facilities.offers().find((candidate) => candidate.definition.id === 'workshop')!;
    expect(offer).toMatchObject({ level: 1, next: offer.definition.levels[1], locked: true });

    reachLevel(game, 2);
    expect(game.facilities.build('workshop')).toEqual({ ok: true, value: 2 });
    expect(game.economy.credits).toBe(20_000 - first! - second!);
    expect(built.at(-1)).toEqual({ facilityId: 'workshop', level: 2, cost: second });
  });

  it('refuses unknown, locked, topped-out and unaffordable facilities without charging', async () => {
    const game = await newCompany(1, 100_000);
    const built = listen(game, 'FacilityBuilt');

    expect(game.facilities.build('casino')).toEqual({ ok: false, error: 'unknownFacility' });
    expect(game.facilities.build('truck_yard')).toEqual({ ok: false, error: 'locked' });
    expect(game.economy.credits).toBe(100_000);
    expect(built).toEqual([]);

    reachLevel(game, 5);
    for (let level = 1; level <= 3; level++) {
      expect(game.facilities.build('logistics_office')).toEqual({ ok: true, value: level });
    }
    const credits = game.economy.credits;
    expect(game.facilities.build('logistics_office')).toEqual({ ok: false, error: 'maxLevel' });
    expect(game.facilities.offers().find((offer) => offer.definition.id === 'logistics_office')).toMatchObject({
      level: 3,
      next: null,
      locked: false,
    });

    game.economy.restore(costs('workshop')[0]! - 1);
    expect(game.facilities.build('workshop')).toEqual({ ok: false, error: 'insufficientFunds' });
    expect(game.economy.credits).toBe(costs('workshop')[0]! - 1);
    expect(game.facilities.levelOf('workshop')).toBe(0);
    expect(built).toHaveLength(3);
    expect(credits).toBe(100_000 - costs('logistics_office').reduce((sum, cost) => sum + cost, 0));
  });

  it('takes a share off repairs and diesel, for the truck being driven and the pump alike', async () => {
    const plain = await newCompany(5, 500_000);
    const built = await companyWith(['workshop', 'fuel_depot']);
    const { fuelPricePerLiter, roadsideFuelPriceFactor, fullRepairCost } = DEFAULT_GAME_CONFIG.economy;

    expect(plain.economy.repairCost(1)).toBe(fullRepairCost);
    expect(built.economy.repairCost(1)).toBe(Math.ceil(fullRepairCost * 0.85 - 1e-9));
    expect(built.economy.repairCost(0.5)).toBe(Math.ceil(fullRepairCost * 0.85 * 0.5 - 1e-9));
    expect(plain.economy.fuelPricePerLiter()).toBe(fuelPricePerLiter);
    expect(built.economy.fuelPricePerLiter()).toBeCloseTo(fuelPricePerLiter * 0.9, 9);
    expect(built.economy.fuelPricePerLiter(true)).toBeCloseTo(fuelPricePerLiter * roadsideFuelPriceFactor * 0.9, 9);
    expect(built.economy.fuelCost(100)).toBe(Math.ceil(100 * fuelPricePerLiter * 0.9 - 1e-9));
    // What a budget buys and what that many litres cost agree, even at the depot's odd price.
    const budget = built.economy.fuelCost(37);
    expect(built.economy.litersAffordable(budget)).toBe(37);
  });

  it('makes room in the garage for more trucks with a truck yard', async () => {
    const plain = await newCompany(2, 100_000);
    const yard = await newCompany(2, 100_000);
    expect(yard.facilities.build('truck_yard')).toEqual({ ok: true, value: 1 });

    expect(yard.garage.capacity).toBe(plain.garage.capacity + 1);
    for (let bought = 1; bought < plain.garage.capacity; bought++) {
      expect(plain.garage.buy('rh_h1').ok).toBe(true);
      expect(yard.garage.buy('rh_h1').ok).toBe(true);
    }
    expect(plain.garage.buy('rh_h1')).toEqual({ ok: false, error: 'garageFull' });
    expect(yard.garage.buy('rh_h1').ok).toBe(true);
  });

  it('raises the fleet\'s pay with a dispatch office, and cuts its diesel with a fuel depot', async () => {
    const plain = await newCompany(5, 100_000);
    const office = await companyWith(['dispatch_office', 'fuel_depot']);
    for (const game of [plain, office]) {
      game.garage.buy('rh_h1');
      game.fleet.hire('driver_kemal');
      game.fleet.assign('driver_kemal', 'truck_002');
      game.fleet.update(1 / 60);
    }
    const planned = plain.fleet.hired[0]!.job!;
    const paid = office.fleet.hired[0]!.job!;

    // The same contract (the same seed), paid 10 % more, rounded to 10 credits, and 10 % less diesel.
    expect(paid).toMatchObject({ originCityId: planned.originCityId, destinationCityId: planned.destinationCityId, cargoId: planned.cargoId });
    expect(Math.abs(paid.pay - planned.pay * 1.1)).toBeLessThanOrEqual(10);
    expect(paid.pay).toBeGreaterThan(planned.pay);
    expect(paid.fuelCost).toBeLessThan(planned.fuelCost);
    expect(Math.abs(paid.fuelCost - planned.fuelCost * 0.9)).toBeLessThanOrEqual(1);
  });

  it('wins the company more standing in the cities with a marketing office', async () => {
    const plain = await newCompany(5, 100_000);
    const marketing = await companyWith(['marketing_office']);
    const points = DEFAULT_GAME_CONFIG.rivals.fleetJobPoints;
    for (const game of [plain, marketing]) {
      game.events.emit('FleetJobCompleted', {
        driverId: 'driver_kemal',
        instanceId: 'truck_002',
        originCityId: 'city_c',
        destinationCityId: 'city_b',
        cargoId: 'farm_produce',
        pay: 1000,
        driverShare: 200,
        fuelCost: 100,
        profit: 700,
        incident: false,
        away: false,
      });
    }
    const standing = (game: Game): number =>
      game.rivals.snapshot().standing.find((entry) => entry.cityId === 'city_c' && entry.companyId === 'player')!.points;

    expect(standing(plain)).toBeCloseTo(points, 6);
    expect(standing(marketing)).toBeCloseTo(points * 1.15, 6);
  });

  it('brings more experience from a delivery with a training centre', async () => {
    const plain = await newCompany(1, 50_000);
    const trained = await newCompany(1, 50_000);
    expect(trained.facilities.build('training_centre').ok).toBe(true);
    const plainDone = listen(plain, 'MissionCompleted');
    const trainedDone = listen(trained, 'MissionCompleted');

    deliver(plain, 'first_package');
    deliver(trained, 'first_package');

    expect(trainedDone[0]!.reward.total).toBe(plainDone[0]!.reward.total);
    expect(trainedDone[0]!.xp).toBe(Math.round(plainDone[0]!.xp * 1.1));
    expect(trained.company.xp).toBe(plain.company.xp - plainDone[0]!.xp + trainedDone[0]!.xp);
  });

  it('puts more contracts of the day on the job board with a logistics office, the same ones first', async () => {
    const game = await newCompany(1, 50_000);
    const daily = (): string[] =>
      game.missions
        .jobBoard()
        .filter((offer) => offer.daily)
        .map((offer) => offer.mission.id);
    const before = daily();
    expect(before).toHaveLength(DEFAULT_GAME_CONFIG.missions.dailyContracts.count);

    expect(game.facilities.build('logistics_office').ok).toBe(true);
    const after = daily();
    expect(after).toHaveLength(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before);
  });

  it('keeps the facilities in the save, and their perks on continue', async () => {
    const storage = new MemoryStorage();
    const first = await bootGame(storage);
    first.session.startNewGame('Kuzey Lojistik');
    reachLevel(first, 2);
    first.economy.restore(50_000);
    first.facilities.build('workshop');
    first.facilities.build('workshop');
    first.facilities.build('truck_yard');
    first.session.save();

    const second = await bootGame(storage);
    second.session.continueGame();
    expect(second.facilities.levelOf('workshop')).toBe(2);
    expect(second.facilities.levelOf('truck_yard')).toBe(1);
    expect(second.facilities.levelOf('fuel_depot')).toBe(0);
    expect(second.economy.repairCost(1)).toBe(Math.ceil(DEFAULT_GAME_CONFIG.economy.fullRepairCost * 0.7 - 1e-9));
    expect(second.garage.capacity).toBe(first.garage.capacity);

    // A new company starts without any.
    second.session.startNewGame('Güney Nakliyat');
    expect(second.facilities.offers().every((offer) => offer.level === 0)).toBe(true);
    expect(second.economy.repairCost(1)).toBe(DEFAULT_GAME_CONFIG.economy.fullRepairCost);
  });

  it('takes a save as the content has it: a facility it no longer has dropped, a level past the top cut to it', async () => {
    const game = await newCompany(1, 5000);
    game.facilities.restore({ levels: { workshop: 9, casino: 2, fuel_depot: 1.5 } });

    expect(game.facilities.snapshot()).toEqual({ levels: { workshop: 3 } });
    expect(game.economy.repairCost(1)).toBe(Math.ceil(DEFAULT_GAME_CONFIG.economy.fullRepairCost * 0.55 - 1e-9));
  });
});
