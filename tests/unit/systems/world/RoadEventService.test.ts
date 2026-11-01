import { describe, expect, it } from 'vitest';
import { MemoryLogger } from '../../../support/MemoryLogger';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { localDay } from '../../../../src/domain/rewards/dailyReward';
import { workZonesForDay } from '../../../../src/domain/world/workZones';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { RoadEventService } from '../../../../src/systems/world/RoadEventService';
import { STEP_SECONDS } from '../../../support/driving';
import { deliver, newCompany, parkInTargetBay, play, type Game } from '../../../support/game';

const ROAD = DEFAULT_GAME_CONFIG.roadEvents;
const LIMITS = DEFAULT_GAME_CONFIG.traffic.speedLimitsKmh;
const NOW_MS = 1_000;

function listen<K extends keyof GameEvents>(game: Game, name: K): GameEvents[K][] {
  const heard: GameEvents[K][] = [];
  game.events.on(name, (event) => heard.push(event));
  return heard;
}

/** The road's events on the game's world, for a truck put anywhere at any speed. */
function roadEvents(game: Game, level = 3) {
  const truck = { x: 0, z: 0, heading: 0, speed: 0 };
  const driving = { isDriving: true, vehicle: truck, world: game.driving.world };
  let luck = 0.5;
  const service = new RoadEventService(
    driving,
    game.economy,
    { level },
    { now: () => NOW_MS },
    0,
    ROAD,
    LIMITS,
    () => luck,
    game.events,
    new MemoryLogger(),
  );
  return {
    service,
    truck,
    setLuck: (value: number) => (luck = value),
    /** Puts the truck at (x, z) heading `heading` at `kmh`, and runs a step. */
    at(x: number, z: number, kmh: number, heading = 0): void {
      Object.assign(truck, { x, z, heading, speed: kmh / 3.6 });
      service.update(STEP_SECONDS);
    },
  };
}

describe('RoadEventService', () => {
  it('lets the first speeding off with a warning, then fines it by the km/h over, once a pass', async () => {
    const game = await newCompany(3, 20_000);
    const { service, at } = roadEvents(game);
    const caught = listen(game, 'SpeedingCaught');
    const camera = game.driving.world.speedCameras.find((candidate) => game.driving.world.roads[candidate.roadIndex]!.kind === 'rural')!;
    const limit = LIMITS.rural;

    // Within the tolerance: nothing.
    at(camera.roadX, camera.roadZ, limit * (1 + ROAD.toleranceShare) + ROAD.toleranceKmh - 0.5);
    expect(caught).toEqual([]);
    at(camera.roadX + 500, camera.roadZ, 0);

    at(camera.roadX, camera.roadZ, 108);
    at(camera.roadX + 1, camera.roadZ, 108); // The same pass: judged once.
    expect(caught).toEqual([{ speedKmh: 108, limitKmh: limit, workZone: false, fine: 0, warning: true }]);
    expect(game.economy.credits).toBe(20_000);

    at(camera.roadX + 500, camera.roadZ, 0);
    at(camera.roadX, camera.roadZ, 108);
    const fine = Math.round((ROAD.fineBase + ROAD.finePerKmh * (108 - limit)) / 10) * 10;
    expect(caught[1]).toEqual({ speedKmh: 108, limitKmh: limit, workZone: false, fine, warning: false });
    expect(game.economy.credits).toBe(20_000 - fine);
    expect(service.snapshot()).toEqual({ warned: true, fined: true, knocked: false });
    expect(game.career.records.fines).toBe(1);
    expect(game.career.records.finesPaid).toBe(fine);
  });

  it('never fines more than the most, nor more than the company has', async () => {
    const game = await newCompany(3, 300);
    const { service, at } = roadEvents(game);
    service.restore({ warned: true, fined: false, knocked: false });
    const camera = game.driving.world.speedCameras[0]!;

    at(camera.roadX, camera.roadZ, 200);

    expect(game.economy.credits).toBe(0);
    expect(game.career.records.finesPaid).toBe(300);
    expect(ROAD.fineMost).toBeLessThan(ROAD.fineBase + ROAD.finePerKmh * 100);
  });

  it('lays the day\'s road works on the main roads, at their limit, their camera\'s fines doubled, the GPS round them', async () => {
    const game = await newCompany(3, 20_000);
    const { service, at, truck } = roadEvents(game);
    const world = game.driving.world;
    const changed = listen(game, 'WorkZonesChanged');
    at(0, 0, 0);

    const zones = workZonesForDay(world, localDay(NOW_MS, 0), ROAD.workZonesPerDay, world.speedCameras);
    expect(service.workZones).toEqual(zones);
    expect(zones.length).toBe(ROAD.workZonesPerDay);
    expect(changed).toEqual([{ count: zones.length }]);
    for (const zone of zones) {
      expect(['highway', 'rural', 'ringRoad']).toContain(world.roads[zone.roadIndex]!.kind);
      expect(zone.cones.length).toBeGreaterThan(10);
    }
    // The same day, the same works: laid once.
    at(10, 0, 0);
    expect(changed).toHaveLength(1);

    const zone = zones[0]!;
    service.restore({ warned: true, fined: false, knocked: false });
    const caught = listen(game, 'SpeedingCaught');
    at(zone.x, zone.z, 70, zone.heading);
    expect(service.workZoneLimitKmh).toBe(ROAD.workZoneLimitKmh);
    const fine = Math.min(ROAD.fineMost, Math.round((ROAD.fineBase + ROAD.finePerKmh * (70 - ROAD.workZoneLimitKmh)) / 10) * 10) * 2;
    expect(caught).toEqual([{ speedKmh: 70, limitKmh: ROAD.workZoneLimitKmh, workZone: true, fine, warning: false }]);

    // Out of them, no limit of theirs.
    Object.assign(truck, { x: zone.x + 2000, z: zone.z });
    service.update(STEP_SECONDS);
    expect(service.workZoneLimitKmh).toBe(0);
  });

  it('shows the camera ahead the truck is heading for, and none behind it', async () => {
    const game = await newCompany(3, 20_000);
    const { service, at } = roadEvents(game);
    const camera = game.driving.world.speedCameras[0]!;
    // 200 m short of it, heading straight for it.
    const heading = Math.atan2(camera.roadX - (camera.roadX - 200), 0);
    at(camera.roadX - 200, camera.roadZ, 40, heading);
    expect(service.cameraAheadMeters).toBeCloseTo(200, 0);
    expect(service.cameraAheadLimitKmh).toBe(LIMITS[game.driving.world.roads[camera.roadIndex]!.kind]);

    at(camera.roadX - 200, camera.roadZ, 40, heading + Math.PI);
    expect(service.cameraAheadMeters).toBe(-1);
  });

  it('sends a stranded driver ahead now and then; stopping beside them a moment helps, for a reward by the company level', async () => {
    const game = await newCompany(4, 1000);
    const { service, at, setLuck } = roadEvents(game, 4);
    const appeared = listen(game, 'StrandedDriverAppeared');
    const helped = listen(game, 'RoadsideHelped');
    const depot = game.driving.world.depotOf('city_a')!.bay;
    setLuck(0.3);

    at(depot.x, depot.z, 0);
    expect(service.stranded).toBeNull();
    service.sendStrandedDriver();
    at(depot.x, depot.z, 0);
    const stranded = service.stranded!;
    expect(stranded).not.toBeNull();
    expect(appeared).toEqual([{ x: stranded.x, z: stranded.z }]);

    // Passing by at speed does not help.
    for (let t = 0; t < ROAD.helpSeconds + 1; t += STEP_SECONDS) {
      at(stranded.x + 4, stranded.z, 30);
    }
    expect(helped).toEqual([]);
    // Stopped beside them.
    for (let t = 0; t < ROAD.helpSeconds + 0.1; t += STEP_SECONDS) {
      at(stranded.x + 4, stranded.z, 0);
    }
    const reward = ROAD.helpReward + ROAD.helpRewardPerLevel * 3;
    expect(helped).toEqual([{ reward }]);
    expect(game.economy.credits).toBe(1000 + reward);
    expect(service.stranded).toBeNull();
    expect(game.career.records.roadsideHelps).toBe(1);
  });

  it('lets a stranded driver go when the truck leaves them far behind', async () => {
    const game = await newCompany(1, 1000);
    const { service, at } = roadEvents(game);
    const depot = game.driving.world.depotOf('city_a')!.bay;
    service.sendStrandedDriver();
    at(depot.x, depot.z, 0);
    const stranded = { ...service.stranded! };

    at(stranded.x + ROAD.strandedBehindMeters + ROAD.strandedAheadMeters[1] + 50, stranded.z, 20);

    expect(service.stranded).toBeNull();
  });
});

describe('the safe-driving bonus', () => {
  it('pays a share of a delivery made without a fine or a knock, in tens', async () => {
    const game = await newCompany(1, 5000);
    let total = 0;
    game.events.on('MissionCompleted', ({ reward }) => (total = reward.total));
    const before = game.economy.credits;

    deliver(game, 'first_package');

    const pay = Math.round((total * ROAD.safeDrivingShare) / 10) * 10;
    expect(pay).toBeGreaterThan(0);
    expect(game.roadEvents.lastDelivery).toEqual({ pay });
    expect(game.economy.credits).toBe(before + total + pay);
  });

  it('pays nothing for a contract with a knock, or a fine, and starts each contract clean', async () => {
    const game = await newCompany(1, 5000);
    const knocked = (): void => void game.events.emit('VehicleCollided', { impactSpeedMetersPerSecond: 9 });
    const finish = (): void => {
      parkInTargetBay(game);
      play(game, DEFAULT_GAME_CONFIG.missions.loadingSeconds + 0.1);
      play(game, 1, 1);
      parkInTargetBay(game);
      play(game, DEFAULT_GAME_CONFIG.missions.loadingSeconds + 0.1);
    };

    game.missions.accept('first_package');
    play(game, STEP_SECONDS);
    knocked();
    finish();
    expect(game.roadEvents.lastDelivery).toEqual({ pay: 0 });

    game.roadEvents.restore({ warned: true, fined: true, knocked: false });
    game.missions.accept('first_package'); // A new contract: clean again.
    expect(game.roadEvents.snapshot()).toEqual({ warned: true, fined: false, knocked: false });
    play(game, STEP_SECONDS);
    game.roadEvents.restore({ warned: true, fined: true, knocked: false });
    finish();
    expect(game.roadEvents.lastDelivery).toEqual({ pay: 0 });
  });
});
