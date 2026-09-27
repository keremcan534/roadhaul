import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { DEFAULT_GAME_CONFIG, type GameConfig } from '../../../../src/data/config/GameConfig';
import { ContentCatalog } from '../../../../src/data/ContentCatalog';
import { knockableCode } from '../../../../src/domain/crash/knockables';
import { WRECK_DEBRIS_KIND } from '../../../../src/domain/crash/wrecks';
import type { VehicleRuntimeState } from '../../../../src/domain/vehicles/VehicleRuntimeState';
import type { StreetLamp } from '../../../../src/domain/world/DrivingWorld';
import { CrashService } from '../../../../src/systems/crash/CrashService';
import { DrivingService } from '../../../../src/systems/driving/DrivingService';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { TrafficService } from '../../../../src/systems/traffic/TrafficService';
import { contentFixture, mapFixture } from '../../../support/contentFixtures';
import { input, STEP_SECONDS } from '../../../support/driving';
import { MemoryLogger } from '../../../support/MemoryLogger';

/** The fixture's street (along z = 0, x -150..150) lit every 20 m. */
const LIT_STREET = mapFixture({ scenery: { seed: 1, treesPerKilometer: 0, streetLampSpacingMeters: 20 } });

function setup(options: { crashes?: Partial<GameConfig['crashes']>; maxVehicles?: number } = {}) {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const config = { ...DEFAULT_GAME_CONFIG.crashes, ...options.crashes };
  const content = ContentCatalog.create(contentFixture({ maps: [LIT_STREET] }));
  const driving = new DrivingService(content, events, logger, config.enabled);
  const traffic = new TrafficService(
    driving,
    content,
    { ...DEFAULT_GAME_CONFIG.traffic, maxVehicles: options.maxVehicles ?? 0 },
    logger,
    config.enabled,
  );
  const crashes = new CrashService(driving, traffic, config, events, logger);
  const seen = {
    knocked: [] as GameEvents['PropKnockedOver'][],
    wrecked: [] as GameEvents['VehicleWrecked'][],
    collisions: [] as number[],
  };
  events.on('PropKnockedOver', (event) => seen.knocked.push(event));
  events.on('VehicleWrecked', (event) => seen.wrecked.push(event));
  events.on('VehicleCollided', ({ impactSpeedMetersPerSecond }) => seen.collisions.push(impactSpeedMetersPerSecond));
  driving.start('test_truck', 'test_map');
  return { driving, traffic, crashes, seen };
}

/** One fixed step as the game runs it: traffic, the truck, then the crashes. */
function step(
  { driving, traffic, crashes }: Pick<ReturnType<typeof setup>, 'driving' | 'traffic' | 'crashes'>,
  throttle = 0,
): void {
  traffic.update(STEP_SECONDS);
  driving.step(STEP_SECONDS, input({ throttle }));
  crashes.update(STEP_SECONDS);
}

/** Puts the truck 6 m short of `lamp`, heading straight at it from the street, at `speed` m/s. */
function towardLamp(driving: DrivingService, lamp: StreetLamp, speed: number): void {
  const heading = lamp.z > 0 ? 0 : Math.PI;
  const front = Math.max(...driving.footprint.offsets) + driving.footprint.radius;
  driving.placeTruck(lamp.x, lamp.z - Math.cos(heading) * (front + 6), heading);
  (driving.vehicle as VehicleRuntimeState).speed = speed;
}

describe('CrashService', () => {
  it('has nothing to show while no truck is driven, or with crashes off', () => {
    const off = setup({ crashes: { enabled: false } });
    step(off);
    expect(off.crashes.simulation).toBeNull();

    const on = setup();
    expect(on.crashes.simulation).toBeNull();
    step(on);
    expect(on.crashes.simulation!.count).toBe(0);
  });

  it('sends a lamp the truck drives into flying, and lets the truck drive on a little slower, with a small crash', () => {
    const game = setup();
    const lamp = game.driving.world.streetLamps[3]!;
    towardLamp(game.driving, lamp, 12);

    for (let i = 0; i < 60 && game.seen.knocked.length === 0; i++) step(game);

    expect(game.seen.knocked).toEqual([{ kind: 'lamp', x: lamp.x, z: lamp.z, speedMetersPerSecond: expect.any(Number), byTruck: true }]);
    const speed = game.seen.knocked[0]!.speedMetersPerSecond;
    expect(speed).toBeGreaterThan(10);
    const debris = game.crashes.simulation!;
    expect(debris.count).toBe(1);
    const slot = debris.active.indexOf(1);
    expect(debris.kind[slot]).toBe(knockableCode('lamp'));
    expect(debris.ref[slot]).toBe(game.driving.world.circleIndexOf(lamp));
    expect(game.crashes.knockedOverCount).toBe(1);
    // A lamp is a small thing to a truck: it drives on, and takes a crash under a third as hard.
    expect(game.driving.vehicle.speed).toBeGreaterThan(10);
    expect(game.seen.collisions).toHaveLength(1);
    expect(game.seen.collisions[0]).toBeCloseTo(speed * 0.3, 6);
    // It flies away, off the way the truck came.
    for (let i = 0; i < 30; i++) step(game);
    expect(Math.hypot(debris.x[slot]! - lamp.x, debris.z[slot]! - lamp.z)).toBeGreaterThan(1);
  });

  it('stands a knocked-over lamp back up once it has lain long enough and is out of sight', () => {
    const game = setup({ crashes: { restoreAfterSeconds: 2 } });
    const lamp = game.driving.world.streetLamps[3]!;
    const circle = game.driving.world.circleIndexOf(lamp);
    towardLamp(game.driving, lamp, 12);
    for (let i = 0; i < 60 && game.seen.knocked.length === 0; i++) step(game);
    game.driving.placeTruck(lamp.x, lamp.z + (lamp.z > 0 ? 20 : -20), 0);

    // Long enough, but in sight: it lies there.
    for (let i = 0; i < 3 / STEP_SECONDS; i++) step(game);
    expect(game.driving.world.knocked[circle]).toBe(1);
    expect(game.crashes.simulation!.count).toBe(1);

    // Out of sight in a far corner of the map: it stands again, and its debris is gone.
    game.driving.placeTruck(lamp.x > 0 ? -190 : 190, -190, 0);
    step(game);
    expect(game.driving.world.knocked[circle]).toBe(0);
    expect(game.crashes.simulation!.count).toBe(0);
    expect(game.crashes.knockedOverCount).toBe(0);
  });

  it('wrecks a car the truck drives into hard, throwing it off in its paint, at a cost to the truck', () => {
    const game = setup({ maxVehicles: 4 });
    step(game);
    // The fixture's street runs along x: heading +x, drive in the lane of the traffic coming the other way.
    game.driving.placeTruck(-60, -2.5, Math.PI / 2);

    for (let i = 0; i < 20 / STEP_SECONDS && game.seen.wrecked.length === 0; i++) step(game, 1);

    expect(game.seen.wrecked).toHaveLength(1);
    const wreck = game.seen.wrecked[0]!;
    expect(wreck.speedMetersPerSecond).toBeGreaterThanOrEqual(8);
    const debris = game.crashes.simulation!;
    const slot = debris.active.indexOf(1);
    expect(debris.kind[slot]).toBe(WRECK_DEBRIS_KIND);
    expect(game.crashes.paintOf(slot)).toBe(wreck.color);
    expect(game.traffic.simulation!.vehicleCount).toBeLessThan(4);
    expect(game.seen.collisions).toHaveLength(1);
    expect(game.seen.collisions[0]).toBeCloseTo(wreck.speedMetersPerSecond * 0.45, 6);
  });

  it('starts afresh on every drive', () => {
    const game = setup();
    const lamp = game.driving.world.streetLamps[3]!;
    towardLamp(game.driving, lamp, 12);
    for (let i = 0; i < 60 && game.seen.knocked.length === 0; i++) step(game);
    const first = game.crashes.simulation;
    expect(first!.count).toBe(1);

    game.driving.start('test_truck', 'test_map');
    step(game);
    expect(game.crashes.simulation).not.toBe(first);
    expect(game.crashes.simulation!.count).toBe(0);
    expect(game.crashes.knockedOverCount).toBe(0);
  });
});
