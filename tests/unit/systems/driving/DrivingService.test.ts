import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { ContentCatalog } from '../../../../src/data/ContentCatalog';
import {
  COLLISION_EVENT_MIN_SPEED,
  DrivingService,
  interpolatePose,
} from '../../../../src/systems/driving/DrivingService';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { contentFixture, mapFixture } from '../../../support/contentFixtures';
import { input, STEP_SECONDS } from '../../../support/driving';
import { MemoryLogger } from '../../../support/MemoryLogger';

/**
 * The fixture map has a building spanning z 35..45 north of the road. Spawning
 * with `headingDegrees: 0` faces it; the fixture truck's nose is 7 m ahead of
 * the rear axle.
 */
function setup(spawn?: { x: number; z: number; headingDegrees: number }) {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const collisions: number[] = [];
  events.on('VehicleCollided', ({ impactSpeedMetersPerSecond }) => collisions.push(impactSpeedMetersPerSecond));
  const map = spawn === undefined ? mapFixture() : mapFixture({ spawn });
  const driving = new DrivingService(ContentCatalog.create(contentFixture({ maps: [map] })), events, logger);
  return { driving, collisions };
}

function stepFor(driving: DrivingService, seconds: number, driverInput = input()): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += STEP_SECONDS) {
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
    const { driving, collisions } = setup({ x: 0, z: 0, headingDegrees: 0 });
    driving.start('test_truck', 'test_map');

    stepFor(driving, 15, input({ throttle: 1 }));

    expect(collisions.length).toBe(1);
    expect(collisions[0]).toBeGreaterThan(5);
    expect(driving.vehicle.z + 7).toBeLessThanOrEqual(35 + 1e-6);
  });

  it('does not report touches slower than the collision threshold', () => {
    // Nose 0.3 m from the wall: the truck cannot build up speed before it touches.
    const { driving, collisions } = setup({ x: 0, z: 27.7, headingDegrees: 0 });
    driving.start('test_truck', 'test_map');

    stepFor(driving, 5, input({ throttle: 1 }));

    expect(collisions).toEqual([]);
    expect(driving.vehicle.z + 7).toBeGreaterThan(34.9);
    expect(COLLISION_EVENT_MIN_SPEED).toBe(1.5);
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
