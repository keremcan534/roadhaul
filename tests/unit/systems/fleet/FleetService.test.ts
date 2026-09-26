import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../../../../src/core/storage/KeyValueStorage';
import { DEFAULT_GAME_CONFIG, type GameConfig } from '../../../../src/data/config/GameConfig';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { bootGame, newCompany, reachLevel, type Game } from '../../../support/game';

/** A company at `level` with a second H1 in the garage and Kemal hired, but not yet on the road. */
async function companyWithDriver(level = 1, credits = 100_000): Promise<Game> {
  const game = await newCompany(level, credits);
  game.garage.buy('rh_h1');
  game.fleet.hire('driver_kemal');
  return game;
}

function listen<K extends keyof GameEvents>(game: Game, name: K): GameEvents[K][] {
  const heard: GameEvents[K][] = [];
  game.events.on(name, (event) => heard.push(event));
  return heard;
}

/** Runs the fleet for `seconds` of game time in fixed steps, as the game loop does. */
function run(game: Game, seconds: number): void {
  const step = 1 / 60;
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += step) {
    game.fleet.update(step);
  }
}

describe('FleetService', () => {
  it('lists every driver, the better ones kept for bigger companies, and hires them for their fee', async () => {
    const game = await newCompany(1, 5000);
    const hired = listen(game, 'DriverHired');
    const roster = game.fleet.roster();
    expect(roster.map((offer) => [offer.definition.id, offer.locked, offer.hired])).toEqual([
      ['driver_kemal', false, false],
      ['driver_selin', false, false],
      ['driver_murat', false, false],
      ['driver_zeynep', true, false],
      ['driver_hakan', true, false],
      ['driver_elif', true, false],
      ['driver_osman', true, false],
      ['driver_derya', true, false],
    ]);

    const kemal = game.fleet.hire('driver_kemal');
    expect(kemal.ok && kemal.value).toMatchObject({ truckInstanceId: null, activity: 'noTruck', cityId: 'city_a', jobsCompleted: 0 });
    expect(game.economy.credits).toBe(4200);
    expect(hired).toEqual([{ driverId: 'driver_kemal', fee: 800 }]);
    expect(game.fleet.hire('driver_kemal')).toEqual({ ok: false, error: 'alreadyHired' });
    expect(game.fleet.hire('driver_zeynep')).toEqual({ ok: false, error: 'locked' });
    expect(game.fleet.hire('driver_nobody')).toEqual({ ok: false, error: 'unknownDriver' });
    game.economy.restore(1000);
    expect(game.fleet.hire('driver_selin')).toEqual({ ok: false, error: 'insufficientFunds' });
    expect(game.fleet.hired.map((driver) => driver.definition.id)).toEqual(['driver_kemal']);
  });

  it('gives a hired driver one of the company\'s other trucks in the garage, never the player\'s or one taken', async () => {
    const game = await companyWithDriver(2);
    game.fleet.hire('driver_selin');
    const assigned = listen(game, 'FleetTruckAssigned');

    expect(game.fleet.assign('driver_murat', 'truck_002')).toEqual({ ok: false, error: 'notHired' });
    expect(game.fleet.assign('driver_kemal', 'truck_009')).toEqual({ ok: false, error: 'unknownTruck' });
    expect(game.fleet.assign('driver_kemal', 'truck_001')).toEqual({ ok: false, error: 'playersTruck' });
    const out = game.fleet.assign('driver_kemal', 'truck_002');
    // Out on a contract from the HQ's city at once.
    expect(out.ok && out.value).toMatchObject({ truckInstanceId: 'truck_002', activity: 'onContract', progress: 0 });
    expect(out.ok && out.value.job?.originCityId).toBe('city_a');
    expect(game.fleet.assign('driver_selin', 'truck_002')).toEqual({ ok: false, error: 'truckTaken' });
    expect(game.fleet.assign('driver_kemal', 'truck_002')).toEqual({ ok: false, error: 'hasTruck' });
    expect(game.garage.trucks[1]).toMatchObject({ driverId: 'driver_kemal' });
    expect(game.garage.switchTo('truck_002')).toEqual({ ok: false, error: 'onTheRoad' });
    expect(assigned).toEqual([{ driverId: 'driver_kemal', instanceId: 'truck_002' }]);
    expect(game.fleet.waiting.map((driver) => driver.definition.id)).toEqual(['driver_selin']);
  });

  it('buys a driver without a truck the cheapest one on sale and sends them out at once; not with the garage full or the money short', async () => {
    const game = await newCompany(1, 30_000);
    game.fleet.hire('driver_kemal');
    const credits = game.economy.credits;
    expect(game.fleet.truckToBuy()?.definition.id).toBe('rh_h1');

    const out = game.fleet.buyTruckFor('driver_kemal');
    expect(out.ok && out.value).toMatchObject({ truckInstanceId: 'truck_002', activity: 'onContract' });
    expect(game.economy.credits).toBe(credits - 12_000);
    expect(game.garage.trucks[1]).toMatchObject({ instanceId: 'truck_002', driverId: 'driver_kemal' });
    expect(game.fleet.buyTruckFor('driver_kemal')).toEqual({ ok: false, error: 'hasTruck' });
    expect(game.fleet.buyTruckFor('driver_selin')).toEqual({ ok: false, error: 'notHired' });
    // A level 1 company's garage holds two trucks: full now.
    game.fleet.hire('driver_selin');
    expect(game.fleet.truckToBuy()).toBeNull();
    expect(game.fleet.buyTruckFor('driver_selin')).toEqual({ ok: false, error: 'garageFull' });

    const poor = await newCompany(1, 5000);
    poor.fleet.hire('driver_kemal');
    expect(poor.fleet.buyTruckFor('driver_kemal')).toEqual({ ok: false, error: 'insufficientFunds' });
    expect(poor.garage.trucks).toHaveLength(1);
  });

  it('takes contract after contract between the cities, and pays the company each one\'s pay less the driver\'s share and the diesel', async () => {
    const game = await companyWithDriver();
    game.fleet.assign('driver_kemal', 'truck_002');
    const delivered = listen(game, 'FleetJobCompleted');
    const credits = game.economy.credits;

    run(game, 1 / 60);
    const first = game.fleet.hired[0]!;
    expect(first.activity).toBe('onContract');
    const job = first.job!;
    expect(job.originCityId).toBe('city_a');
    expect(job.destinationCityId).not.toBe('city_a');
    expect(job.durationSeconds).toBeGreaterThan(120);
    expect(job.durationSeconds).toBeLessThan(900);

    run(game, job.durationSeconds / 2);
    expect(game.fleet.hired[0]!.progress).toBeCloseTo(0.5, 1);
    expect(delivered).toEqual([]);
    run(game, job.durationSeconds / 2 + 0.1);

    expect(delivered).toHaveLength(1);
    const profit = job.pay - job.driverShare - job.fuelCost;
    expect(delivered[0]).toMatchObject({
      driverId: 'driver_kemal',
      instanceId: 'truck_002',
      destinationCityId: job.destinationCityId,
      pay: job.pay,
      profit,
      away: false,
    });
    expect(profit).toBeGreaterThan(0);
    expect(game.economy.credits).toBe(credits + profit);
    const after = game.fleet.hired[0]!;
    expect(after).toMatchObject({ jobsCompleted: 1, creditsEarned: profit, cityId: job.destinationCityId });
    // The next contract leaves from where the last one went.
    expect(after.job?.originCityId ?? job.destinationCityId).toBe(job.destinationCityId);
  });

  it('sends a truck battered on its contracts to the workshop, at the company\'s cost, before it goes on', async () => {
    // Every contract damages the truck badly enough for the workshop.
    const config: GameConfig = { ...DEFAULT_GAME_CONFIG, fleet: { ...DEFAULT_GAME_CONFIG.fleet, incidentDamage: 0.5, repairAtDamage: 0.45 } };
    const game = await bootGame(undefined, 1000, config);
    game.session.startNewGame('Kuzey Lojistik');
    game.economy.restore(100_000);
    game.garage.buy('rh_h1');
    game.fleet.hire('driver_kemal');
    game.fleet.assign('driver_kemal', 'truck_002');
    const repaired = listen(game, 'FleetTruckRepaired');
    const delivered = listen(game, 'FleetJobCompleted');

    run(game, 1 / 60);
    while (!delivered.some((job) => job.incident) && delivered.length < 200) {
      run(game, 30);
    }

    const incidents = delivered.filter((job) => job.incident).length;
    expect(incidents).toBe(1);
    expect(repaired).toHaveLength(incidents);
    expect(repaired[0]).toEqual({ driverId: 'driver_kemal', instanceId: 'truck_002', cost: 3000 });
    // Out of the workshop as good as new.
    expect(game.garage.trucks[1]!.damage).toBeLessThan(0.5);
  });

  it('brings a truck back to the garage when asked, losing the contract under way, and lets a driver go', async () => {
    const game = await companyWithDriver();
    game.fleet.assign('driver_kemal', 'truck_002');
    run(game, 60);
    const dismissed = listen(game, 'DriverDismissed');
    const credits = game.economy.credits;

    const back = game.fleet.recall('driver_kemal');
    expect(back.ok && back.value).toMatchObject({ truckInstanceId: null, activity: 'noTruck', job: null, cityId: 'city_a' });
    expect(game.fleet.recall('driver_kemal')).toEqual({ ok: false, error: 'noTruck' });
    expect(game.garage.trucks[1]!.driverId).toBeNull();
    expect(game.garage.switchTo('truck_002').ok).toBe(true);
    // Now the player's: no driver takes it.
    expect(game.fleet.assign('driver_kemal', 'truck_002')).toEqual({ ok: false, error: 'playersTruck' });
    expect(game.fleet.assign('driver_kemal', 'truck_001').ok).toBe(true);

    expect(game.fleet.dismiss('driver_kemal')).toEqual({ ok: true, value: undefined });
    expect(game.fleet.dismiss('driver_kemal')).toEqual({ ok: false, error: 'notHired' });
    expect(game.fleet.dismiss('driver_nobody')).toEqual({ ok: false, error: 'unknownDriver' });
    expect(dismissed).toEqual([{ driverId: 'driver_kemal' }]);
    expect(game.garage.trucks[0]!.driverId).toBeNull();
    expect(game.fleet.hired).toEqual([]);
    expect(game.economy.credits).toBe(credits);
  });

  it('shows each truck on a contract on the map: at the bay while loading, then along the road', async () => {
    const game = await companyWithDriver();
    expect(game.fleet.updateMarkers()).toBe(0);
    game.fleet.assign('driver_kemal', 'truck_002');
    run(game, 1 / 60);
    const job = game.fleet.hired[0]!.job!;
    const bay = game.driving.world.depotOf(job.originCityId)!.bay;

    expect(game.fleet.updateMarkers()).toBe(1);
    const marker = game.fleet.markers[0]!;
    // Known by its driver, bound for its contract's end, in its paint (the model's factory colour until painted).
    expect(marker).toMatchObject({
      key: 'driver_kemal',
      driverId: 'driver_kemal',
      moving: false,
      destinationCityId: job.destinationCityId,
      color: game.garage.trucks[1]!.definition.factoryColor,
    });
    expect(Math.hypot(marker.x - bay.x, marker.z - bay.z)).toBeLessThan(1);

    run(game, job.durationSeconds / 2);
    game.fleet.updateMarkers();
    expect(marker.moving).toBe(true);
    const target = game.driving.world.depotOf(job.destinationCityId)!.bay;
    expect(Math.hypot(marker.x - bay.x, marker.z - bay.z)).toBeGreaterThan(100);
    expect(Math.hypot(marker.x - target.x, marker.z - target.z)).toBeGreaterThan(100);
  });

  it('keeps the fleet in the save, and works on while the game was closed, for up to two hours', async () => {
    const first = await companyWithDriver();
    first.fleet.assign('driver_kemal', 'truck_002');
    run(first, 90);
    first.session.save();
    const saved = first.fleet.hired[0]!;
    /** The storage as the first session left it: each continuation below starts from it. */
    const leftBehind = (): MemoryStorage => {
      const storage = new MemoryStorage();
      for (const key of first.storage.keys()) {
        storage.setItem(key, first.storage.getItem(key)!);
      }
      return storage;
    };

    // Back after five minutes: the contract under way goes on where it was.
    const soon = await bootGame(leftBehind(), 1000 + 300_000);
    const caughtUp = listen(soon, 'FleetCaughtUp');
    soon.session.continueGame();
    expect(soon.garage.trucks[1]!.driverId).toBe('driver_kemal');
    expect(caughtUp).toHaveLength(1);
    expect(caughtUp[0]!.seconds).toBeCloseTo(300, 6);
    const resumed = soon.fleet.hired[0]!;
    expect(resumed.jobsCompleted).toBeGreaterThanOrEqual(saved.jobsCompleted);
    if (resumed.jobsCompleted === saved.jobsCompleted) {
      expect(resumed.job).toEqual(saved.job);
      expect(resumed.progress).toBeGreaterThan(saved.progress);
    }

    // Back after a day: two hours' work, paid.
    const later = await bootGame(leftBehind(), 1000 + 24 * 3600_000);
    const laterCaughtUp = listen(later, 'FleetCaughtUp');
    const delivered = listen(later, 'FleetJobCompleted');
    later.session.continueGame();
    const credits = later.session.snapshot().economy.credits;
    expect(laterCaughtUp).toHaveLength(1);
    expect(laterCaughtUp[0]!.seconds).toBe(2 * 3600);
    expect(laterCaughtUp[0]!.jobs).toBe(delivered.length);
    expect(delivered.length).toBeGreaterThan(8);
    expect(delivered.every((job) => job.away)).toBe(true);
    expect(laterCaughtUp[0]!.credits).toBeGreaterThan(0);
    expect(credits).toBe(first.economy.credits + laterCaughtUp[0]!.credits);
    expect(later.fleet.hired[0]!.jobsCompleted).toBe(saved.jobsCompleted + delivered.length);
  });

  it('does nothing while away without a truck on the road, and nothing without drivers', async () => {
    const game = await companyWithDriver();
    const caughtUp = listen(game, 'FleetCaughtUp');
    game.fleet.catchUp(3600);
    run(game, 600);
    expect(caughtUp).toEqual([]);
    expect(game.fleet.hired[0]!.jobsCompleted).toBe(0);

    reachLevel(game, 3);
    expect(game.fleet.roster().find((offer) => offer.definition.id === 'driver_elif')!.locked).toBe(false);
  });
});
