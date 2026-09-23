import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { ContentCatalog } from '../../../../src/data/ContentCatalog';
import { BASE_PERFORMANCE } from '../../../../src/domain/vehicles/performance';
import {
  COLLISION_EVENT_MIN_SPEED,
  DrivingService,
  interpolatePose,
} from '../../../../src/systems/driving/DrivingService';
import type { MapDefinition } from '../../../../src/data/definitions/MapDefinition';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { contentFixture, mapFixture, vehicleFixture } from '../../../support/contentFixtures';
import { input, STEP_SECONDS } from '../../../support/driving';
import { MemoryLogger } from '../../../support/MemoryLogger';

/**
 * The fixture map has a building spanning z 35..45 north of the road. Spawning
 * with `headingDegrees: 0` faces it; the fixture truck's nose is 7 m ahead of
 * the rear axle.
 */
function setup(mapOverrides: Partial<MapDefinition> = {}) {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const collisions: number[] = [];
  events.on('VehicleCollided', ({ impactSpeedMetersPerSecond }) => collisions.push(impactSpeedMetersPerSecond));
  const map = mapFixture(mapOverrides);
  const bigTruck = vehicleFixture({ id: 'big_truck', maxPayloadTons: 20 });
  const content = ContentCatalog.create(
    contentFixture({ maps: [map], vehicles: [vehicleFixture(), { ...bigTruck, body: { ...bigTruck.body, massKg: 12000 } }] }),
  );
  const driving = new DrivingService(content, events, logger);
  return { driving, collisions };
}

/** Steps at 60 Hz for `seconds`, or until `until` returns true. */
function stepFor(driving: DrivingService, seconds: number, driverInput = input(), until = (): boolean => false): void {
  for (let elapsed = 0; elapsed < seconds && !until(); elapsed += STEP_SECONDS) {
    driving.step(STEP_SECONDS, driverInput);
  }
}

describe('DrivingService', () => {
  it('is idle until a drive starts', () => {
    const { driving } = setup();

    expect(driving.isDriving).toBe(false);
    expect(() => driving.vehicle).toThrow('No truck is being driven.');
    expect(() => driving.step(STEP_SECONDS, input({ throttle: 1 }))).not.toThrow();
  });

  it('puts the truck at the map spawn, at rest', () => {
    const { driving } = setup();

    driving.start('test_truck', 'test_map');

    expect(driving.isDriving).toBe(true);
    expect(driving.definition.id).toBe('test_truck');
    expect(driving.vehicle).toMatchObject({ x: 0, z: 0, speed: 0, gear: 1 });
    expect(driving.vehicle.heading).toBeCloseTo(Math.PI / 2, 12);
    expect(driving.previousPose).toEqual({ x: 0, z: 0, heading: driving.vehicle.heading });
  });

  it('drives the truck along the road and remembers the previous pose', () => {
    const { driving } = setup();
    driving.start('test_truck', 'test_map');
    stepFor(driving, 3, input({ throttle: 1 }));
    const before = { x: driving.vehicle.x, z: driving.vehicle.z };

    driving.step(STEP_SECONDS, input({ throttle: 1 }));

    expect(driving.previousPose.x).toBe(before.x);
    expect(driving.previousPose.z).toBe(before.z);
    expect(driving.vehicle.x).toBeGreaterThan(before.x);
    expect(driving.vehicle.z).toBeCloseTo(0, 9);
  });

  it('reports one collision when the truck drives into a building, then keeps it outside', () => {
    const { driving, collisions } = setup({ spawn: { x: 0, z: 0, headingDegrees: 0 } });
    driving.start('test_truck', 'test_map');

    stepFor(driving, 15, input({ throttle: 1 }));

    expect(collisions.length).toBe(1);
    expect(collisions[0]).toBeGreaterThan(5);
    expect(driving.vehicle.z + 7).toBeLessThanOrEqual(35 + 1e-6);
  });

  it('does not report touches slower than the collision threshold', () => {
    // Nose 0.3 m from the wall: the truck cannot build up speed before it touches.
    const { driving, collisions } = setup({ spawn: { x: 0, z: 27.7, headingDegrees: 0 } });
    driving.start('test_truck', 'test_map');

    stepFor(driving, 5, input({ throttle: 1 }));

    expect(collisions).toEqual([]);
    expect(driving.vehicle.z + 7).toBeGreaterThan(34.9);
    expect(COLLISION_EVENT_MIN_SPEED).toBe(1.5);
  });

  it.each([5, 10, 20, 35])('reports a %i° scrape along a wall once and lets the truck drive on', (angleDegrees) => {
    // Full throttle from x = 184, angled toward the map's east edge (x = 200), on a road that reaches the edge.
    const { driving, collisions } = setup({
      roads: [{ id: 'edge_road', kind: 'street', widthMeters: 20, closed: false, controlPoints: [[190, -195], [190, 195]] }],
      spawn: { x: 184, z: -190, headingDegrees: angleDegrees },
    });
    driving.start('test_truck', 'test_map');

    stepFor(driving, 40, input({ throttle: 1 }), () => driving.vehicle.z > 150);

    expect(collisions).toHaveLength(1);
    // It slid along the wall instead of sticking to it, and kept accelerating.
    expect(driving.vehicle.z).toBeGreaterThan(150);
    expect(driving.vehicle.heading).toBeCloseTo(0, 6);
    expect(driving.vehicle.speed * 3.6).toBeGreaterThan(60);
  });

  it('makes a loaded truck slower to accelerate', () => {
    const empty = setup().driving;
    const loaded = setup().driving;
    empty.start('test_truck', 'test_map');
    loaded.start('test_truck', 'test_map');
    loaded.setCargoMass(10_000);

    stepFor(empty, 4, input({ throttle: 1 }));
    stepFor(loaded, 4, input({ throttle: 1 }));

    expect(loaded.vehicle.speed).toBeLessThan(empty.vehicle.speed * 0.8);
    loaded.setCargoMass(0);
    expect(() => loaded.setCargoMass(0)).not.toThrow();
  });

  it('multiplies performance modifiers from every source and keeps them for later drives', () => {
    const plain = setup().driving;
    const modified = setup().driving;
    plain.start('test_truck', 'test_map');
    modified.setPerformanceModifier('damage', { ...BASE_PERFORMANCE, torqueFactor: 0.8 });
    modified.setPerformanceModifier('upgrade', { ...BASE_PERFORMANCE, torqueFactor: 0.8 });
    modified.start('test_truck', 'test_map'); // Set before the drive started: still applied.

    stepFor(plain, 12, input({ throttle: 1 }));
    stepFor(modified, 12, input({ throttle: 1 }));

    // 0.8 × 0.8 of the torque: about 55 instead of 69 km/h after 12 s.
    expect(modified.vehicle.speed).toBeLessThan(plain.vehicle.speed * 0.85);
  });

  it('swaps the truck in place: same spot, world, cargo and odometer, the new truck at rest', () => {
    const { driving } = setup();
    driving.start('test_truck', 'test_map');
    driving.setCargoMass(2000);
    driving.setEngineRunning(false);
    stepFor(driving, 0.1);
    driving.setEngineRunning(true);
    stepFor(driving, 3, input({ throttle: 1 }));
    const { x, z, heading, odometerMeters } = driving.vehicle;
    const world = driving.world;
    const state = driving.vehicle;

    driving.switchVehicle('big_truck');

    expect(driving.definition.id).toBe('big_truck');
    expect(driving.world).toBe(world);
    expect(driving.vehicle).toBe(state); // Presentation may hold on to the state.
    expect(driving.vehicle).toMatchObject({ x, z, heading, odometerMeters, speed: 0, gear: 1 });
    expect(driving.previousPose).toEqual({ x, z, heading });
    expect(driving.cargoMassKg).toBe(2000);
    expect(driving.totalMassKg).toBe(14000);
    expect(() => driving.switchVehicle('ghost_truck')).toThrow('Unknown vehicle "ghost_truck".');
  });

  it('applies the performance modifiers to a truck swapped in', () => {
    const plain = setup().driving;
    const modified = setup().driving;
    for (const driving of [plain, modified]) {
      driving.start('test_truck', 'test_map');
    }
    modified.setPerformanceModifier('upgrades', { ...BASE_PERFORMANCE, torqueFactor: 0.6 });
    plain.switchVehicle('big_truck');
    modified.switchVehicle('big_truck');

    stepFor(plain, 12, input({ throttle: 1 }));
    stepFor(modified, 12, input({ throttle: 1 }));

    expect(modified.vehicle.speed).toBeLessThan(plain.vehicle.speed * 0.85);
  });

  it('knows when the middle of the truck stands in a depot yard or at a rest area', () => {
    const lot = { x: 0, z: 40, headingDegrees: 90, lengthMeters: 60, widthMeters: 30 };
    const { driving } = setup({ restAreas: [{ id: 'test_rest', lot }], buildings: [] });
    expect(driving.servicePoint).toBeNull(); // Nothing driven yet.
    driving.start('test_truck', 'test_map');

    expect(driving.servicePoint).toBeNull(); // The spawn is on the open road.
    // Rear axle just outside the yard (x = -122 to -78, z = -30 to -4); 2.5 m ahead, the middle of the truck is inside.
    driving.placeTruck(-123, -17, Math.PI / 2);
    expect(driving.servicePoint).toMatchObject({ kind: 'depot', depot: { id: 'test_origin_depot' } });
    driving.placeTruck(0, 40, Math.PI / 2);
    expect(driving.servicePoint).toMatchObject({ kind: 'restArea', restArea: { id: 'test_rest' } });
  });

  it('keeps a stalled engine stalled across drives until it is restarted', () => {
    const { driving } = setup();
    driving.setEngineRunning(false);
    driving.start('test_truck', 'test_map');

    stepFor(driving, 2, input({ throttle: 1 }));
    expect(driving.isEngineRunning).toBe(false);
    expect(driving.vehicle.speed).toBe(0);

    driving.setEngineRunning(true);
    stepFor(driving, 2, input({ throttle: 1 }));
    expect(driving.vehicle.speed).toBeGreaterThan(1);
  });

  it('reports the cargo on board and the ground under the truck', () => {
    const { driving } = setup();
    driving.start('test_truck', 'test_map');
    driving.setCargoMass(4500);
    stepFor(driving, 0.1);

    expect(driving.cargoMassKg).toBe(4500);
    expect(driving.surface.name).toBe('asphalt');

    driving.placeTruck(0, 20, 0); // On the grass north of the road.
    stepFor(driving, 0.1);
    expect(driving.surface.name).toBe('grass');
  });

  it('places the truck at rest, without interpolating from where it was', () => {
    const { driving } = setup();
    driving.start('test_truck', 'test_map');
    stepFor(driving, 3, input({ throttle: 1, steer: 0.3 }));
    const odometer = driving.vehicle.odometerMeters;

    driving.placeTruck(-100, -20, Math.PI);

    expect(driving.vehicle).toMatchObject({ x: -100, z: -20, heading: Math.PI, speed: 0, steerAngle: 0, gear: 1 });
    expect(driving.vehicle.odometerMeters).toBe(odometer);
    expect(driving.previousPose).toEqual({ x: -100, z: -20, heading: Math.PI });
  });

  it('recovers a stuck truck onto the nearest road, facing along it the way it was heading', () => {
    const { driving } = setup();
    driving.start('test_truck', 'test_map');
    // On the grass north of the road, nose to the building, heading a little west of north.
    driving.placeTruck(20, 25, -0.3 + 2 * Math.PI);

    driving.recover();

    expect(driving.vehicle.z).toBeCloseTo(0, 6);
    expect(Math.abs(driving.vehicle.x - 20)).toBeLessThanOrEqual(3); // The nearest centreline sample.
    // The road runs along X; west (-90°) is closer to the old heading than east. The heading stays unwrapped.
    expect(driving.vehicle.heading).toBeCloseTo(-Math.PI / 2 + 2 * Math.PI, 6);
    expect(driving.vehicle.speed).toBe(0);
  });

  it('rejects unknown trucks and maps', () => {
    const { driving } = setup();

    expect(() => driving.start('ghost_truck', 'test_map')).toThrow('Unknown vehicle "ghost_truck".');
    expect(() => driving.start('test_truck', 'atlantis')).toThrow('Unknown map "atlantis".');
    expect(driving.isDriving).toBe(false);
  });

  it('interpolates poses between fixed steps without allocating', () => {
    const out = { x: 0, z: 0, heading: 0 };

    const result = interpolatePose(out, { x: 0, z: 10, heading: 1 }, { x: 4, z: 20, heading: 2 }, 0.25);

    expect(result).toBe(out);
    expect(out).toEqual({ x: 1, z: 12.5, heading: 1.25 });
  });

  it('stops driving on stop() and on dispose()', () => {
    const { driving } = setup();
    driving.start('test_truck', 'test_map');
    driving.stop();
    expect(driving.isDriving).toBe(false);

    driving.start('test_truck', 'test_map');
    driving.dispose();
    expect(driving.isDriving).toBe(false);
  });
});
