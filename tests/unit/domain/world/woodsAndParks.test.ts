import { describe, expect, it } from 'vitest';
import { rectangleContains } from '../../../../src/data/definitions/MapDefinition';
import { VehicleDynamics } from '../../../../src/domain/vehicles/VehicleDynamics';
import { createVehicleFootprint } from '../../../../src/domain/vehicles/VehicleFootprint';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { FOREST_ROADSIDE_METERS, forestContains } from '../../../../src/domain/world/forests';
import { onParkPath, PARK_FOUNTAIN_RADIUS_METERS, PARK_HEDGE_INSET_METERS } from '../../../../src/domain/world/parks';
import { mapFixture, vehicleFixture } from '../../../support/contentFixtures';

const truck = vehicleFixture();
const footprint = createVehicleFootprint(truck.body);
/** Centre of the front footprint circle, meters ahead of the rear axle. */
const front = Math.max(...footprint.offsets);

function truckAt(x: number, z: number, headingDegrees: number, speed: number) {
  const state = new VehicleDynamics(truck).createState(x, z, (headingDegrees * Math.PI) / 180);
  state.speed = speed;
  return state;
}

/**
 * The fixture's street along z = 0 (10 m wide) with a building at (0, 40):
 * a broadleaf wood north of the street, round the building, and a park
 * south of it, between the depots.
 */
const world = new DrivingWorld(
  mapFixture({
    forests: [
      {
        id: 'north_wood',
        kind: 'broadleaf',
        outline: [
          [-150, 12],
          [150, 12],
          [150, 190],
          [-150, 190],
        ],
      },
    ],
    parks: [{ id: 'south_park', area: { x: 0, z: -100, headingDegrees: 0, lengthMeters: 60, widthMeters: 50 } }],
    scenery: { seed: 3, treesPerKilometer: 60 },
  }),
);
const [wood] = world.forests;
const [park] = world.parks;

describe('a forest in the world', () => {
  const trees = world.trees.filter((tree) => forestContains(wood!, tree.x, tree.z));

  it('is planted with its own trees, broadleaves mostly, some deep in it, back from the road and the building', () => {
    expect(trees.length).toBeGreaterThan(300);
    expect(trees.every((tree) => tree.species === 'pine' || tree.species === 'broadleaf')).toBe(true);
    expect(trees.filter((tree) => tree.species === 'broadleaf').length / trees.length).toBeGreaterThan(0.8);
    expect(trees.some((tree) => tree.inner === true)).toBe(true);
    // Only its side toward the street, seen from near by, grows close: 100 m from the street's edge, none.
    expect(trees.some((tree) => tree.inner !== true)).toBe(true);
    expect(trees.filter((tree) => tree.inner !== true).every((tree) => tree.z < 5 + FOREST_ROADSIDE_METERS)).toBe(true);
    for (const tree of trees) {
      // The street's edge is 5 m out: as far back as the wild trees stand.
      expect(Math.abs(tree.z)).toBeGreaterThan(9);
      expect(Math.hypot(Math.max(0, Math.abs(tree.x) - 10), Math.max(0, Math.abs(tree.z - 40) - 5))).toBeGreaterThan(3.9);
    }
  });

  it('keeps the wild trees along the road out of it, and out of the park', () => {
    const wild = world.trees.filter((tree) => tree.species === undefined);
    expect(wild.length).toBeGreaterThan(2);
    for (const tree of wild) {
      expect(forestContains(wood!, tree.x, tree.z)).toBe(false);
      expect(rectangleContains(park!.area, tree.x, tree.z, 1.9)).toBe(false);
    }
  });

  it('stops a truck driving into its trees', () => {
    const [tree] = trees.filter((candidate) => candidate.z < 30 && Math.abs(candidate.x) < 120);
    const state = truckAt(tree!.x, tree!.z - (front + footprint.radius + tree!.radius - 0.3), 0, 6);
    expect(world.resolveCollisions(state, footprint)).toBeGreaterThan(5);
  });
});

describe('a park in the world', () => {
  const inPark = (x: number, z: number): boolean => rectangleContains(park!.area, x, z);

  it('has its trees, benches, bins and lamps, none on its paths', () => {
    const trees = world.trees.filter((tree) => inPark(tree.x, tree.z));
    const furniture = world.streetFurniture.filter((piece) => inPark(piece.x, piece.z));
    const lamps = world.streetLamps.filter((lamp) => inPark(lamp.x, lamp.z));
    expect(trees.length).toBeGreaterThan(10);
    expect(trees.every((tree) => tree.species === 'broadleaf')).toBe(true);
    expect(furniture.filter((piece) => piece.kind === 'bench').length).toBeGreaterThan(4);
    expect(furniture.some((piece) => piece.kind === 'bin')).toBe(true);
    expect(lamps.length).toBeGreaterThan(2);
    for (const thing of [...trees, ...furniture, ...lamps]) {
      expect(onParkPath(park!, thing.x, thing.z)).toBe(false);
    }
  });

  it('stops a truck at its fountain', () => {
    const state = truckAt(0, -100 - (front + footprint.radius + PARK_FOUNTAIN_RADIUS_METERS - 0.3), 0, 5);
    expect(world.resolveCollisions(state, footprint)).toBeGreaterThan(4);
  });

  it('stops a truck at its hedge, and lets it in where a path comes through', () => {
    const hedge = -130 + PARK_HEDGE_INSET_METERS;
    const blocked = truckAt(15, hedge - (front + footprint.radius - 0.3), 0, 5);
    expect(world.resolveCollisions(blocked, footprint)).toBeGreaterThan(4);
    expect(blocked.z + front + footprint.radius).toBeLessThanOrEqual(hedge + 1e-6);
    // Through the gap in the hedge where the path along the park comes in.
    const through = truckAt(0, hedge - (front + footprint.radius - 0.3), 0, 5);
    expect(world.resolveCollisions(through, footprint)).toBe(0);
  });
});
