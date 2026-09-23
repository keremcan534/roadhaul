import { describe, expect, it } from 'vitest';
import { MAPS } from '../../../../src/data/content/maps';
import { VehicleDynamics } from '../../../../src/domain/vehicles/VehicleDynamics';
import { createVehicleFootprint } from '../../../../src/domain/vehicles/VehicleFootprint';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { ASPHALT, GRASS } from '../../../../src/domain/world/Surface';
import { mapFixture, vehicleFixture } from '../../../support/contentFixtures';

const truck = vehicleFixture();
const footprint = createVehicleFootprint(truck.body);

/** A truck whose rear axle is at (x, z), facing `headingDegrees`, rolling at `speed` m/s. */
function truckAt(x: number, z: number, headingDegrees: number, speed: number) {
  const state = new VehicleDynamics(truck).createState(x, z, (headingDegrees * Math.PI) / 180);
  state.speed = speed;
  return state;
}

/** Centres of the footprint circles along the Z axis. */
function circleZs(state: { z: number; heading: number }): number[] {
  return footprint.offsets.map((offset) => state.z + Math.cos(state.heading) * offset);
}

describe('DrivingWorld', () => {
  const world = new DrivingWorld(mapFixture());

  it('is asphalt on the road and grass beside it', () => {
    expect(world.surfaceAt(0, 0)).toBe(ASPHALT);
    expect(world.surfaceAt(50, 4)).toBe(ASPHALT);
    expect(world.surfaceAt(50, 8)).toBe(GRASS);
  });

  it('takes the spawn point and heading from the map', () => {
    expect(world.spawn.x).toBe(0);
    expect(world.spawn.z).toBe(0);
    expect(world.spawn.heading).toBeCloseTo(Math.PI / 2, 12);
  });

  it('stops a truck that drives head-on into a building', () => {
    // The building spans z 35..45; the fixture truck's nose (7 m ahead of the rear axle) is 1 m inside it.
    const state = truckAt(0, 29, 0, 10);

    const impact = world.resolveCollisions(state, footprint);

    expect(impact).toBeCloseTo(10, 6);
    expect(state.speed).toBeCloseTo(0, 9);
    const noseZ = state.z + Math.cos(state.heading) * Math.max(...footprint.offsets) + footprint.radius;
    expect(noseZ).toBeLessThanOrEqual(35 + 1e-9);
  });

  it('only slows a truck that scrapes along a wall', () => {
    // Driving east, 15° toward the building's south wall (z = 35); two circles touch it.
    const state = truckAt(-5, 33, 75, 10);

    const impact = world.resolveCollisions(state, footprint);

    expect(impact).toBeCloseTo(10 * Math.cos((75 * Math.PI) / 180), 6);
    expect(state.speed).toBeCloseTo(10 * (1 - Math.cos((75 * Math.PI) / 180) ** 2), 6);
  });

  it('ignores obstacles the truck is already moving away from', () => {
    // Facing the building with the nose 0.1 m inside it, but reversing away.
    const state = truckAt(0, 28.1, 0, -3);

    expect(world.resolveCollisions(state, footprint)).toBe(0);
    expect(state.speed).toBe(-3);
    expect(state.heading).toBe(0);
    expect(Math.max(...circleZs(state)) + footprint.radius).toBeCloseTo(35, 9);
  });

  it('stops a reversing truck that backs into a building', () => {
    // Facing north just past the building (z ≤ 45); the tail is 0.5 m inside it.
    const state = truckAt(0, 46.5, 0, -3);

    const impact = world.resolveCollisions(state, footprint);

    expect(impact).toBeCloseTo(3, 6);
    expect(state.speed).toBeCloseTo(0, 9);
  });

  it('keeps the truck inside the map boundary', () => {
    const state = truckAt(0, 195, 0, 20);

    world.resolveCollisions(state, footprint);

    expect(state.speed).toBeCloseTo(0, 9);
    for (const offset of footprint.offsets) {
      expect(state.z + offset + footprint.radius).toBeLessThanOrEqual(200 + 1e-9);
    }
  });

  it('does nothing when there is nothing to hit', () => {
    const state = truckAt(0, 0, 90, 20);

    expect(world.resolveCollisions(state, footprint)).toBe(0);
    expect(state).toMatchObject({ x: 0, z: 0, speed: 20 });
  });

  describe('trees', () => {
    const map = MAPS[0]!;
    const forest = new DrivingWorld(map);

    it('are generated deterministically from the seed', () => {
      expect(new DrivingWorld(map).trees).toEqual(forest.trees);
      expect(new DrivingWorld({ ...map, scenery: { ...map.scenery, seed: 1 } }).trees).not.toEqual(forest.trees);
    });

    it('line the roads without standing on them, near the start or outside the map', () => {
      expect(forest.trees.length).toBeGreaterThan(100);
      for (const tree of forest.trees) {
        expect(forest.surfaceAt(tree.x, tree.z)).toBe(GRASS);
        expect(Math.min(...forest.roads.map((road) => road.distanceTo(tree.x, tree.z)))).toBeGreaterThan(8);
        expect(Math.hypot(tree.x - forest.spawn.x, tree.z - forest.spawn.z)).toBeGreaterThan(19);
        expect(Math.abs(tree.x)).toBeLessThan(map.halfSizeMeters);
        expect(Math.abs(tree.z)).toBeLessThan(map.halfSizeMeters);
      }
    });

    it('are solid', () => {
      const tree = forest.trees[0]!;
      // Place the truck's front circle just short of the trunk, driving straight at it.
      const heading = Math.atan2(tree.x - forest.spawn.x, tree.z - forest.spawn.z);
      const frontOffset = Math.max(...footprint.offsets);
      const reach = frontOffset + footprint.radius + tree.radius - 0.2;
      const state = truckAt(0, 0, 0, 8);
      state.heading = heading;
      state.x = tree.x - Math.sin(heading) * reach;
      state.z = tree.z - Math.cos(heading) * reach;

      expect(forest.resolveCollisions(state, footprint)).toBeGreaterThan(7);
      expect(Math.abs(state.speed)).toBeLessThan(1);
    });
  });
});
