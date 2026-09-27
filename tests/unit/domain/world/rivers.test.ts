import { describe, expect, it } from 'vitest';
import { MAPS } from '../../../../src/data/content/maps';
import type { RiverDefinition } from '../../../../src/data/definitions/MapDefinition';
import { VehicleDynamics } from '../../../../src/domain/vehicles/VehicleDynamics';
import { createVehicleFootprint } from '../../../../src/domain/vehicles/VehicleFootprint';
import { BRIDGE_ABUTMENT_METERS, BRIDGE_KERB_METERS } from '../../../../src/domain/world/bridges';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { RIVER_BANK_METERS, RiverPath } from '../../../../src/domain/world/RiverPath';
import { mapFixture, seaFixture, vehicleFixture } from '../../../support/contentFixtures';

const truck = vehicleFixture();
const footprint = createVehicleFootprint(truck.body);
/** Centre of the front footprint circle, meters ahead of the rear axle. */
const front = Math.max(...footprint.offsets);
const degrees = (value: number): number => (value * Math.PI) / 180;

function truckAt(x: number, z: number, headingDegrees: number, speed: number) {
  const state = new VehicleDynamics(truck).createState(x, z, degrees(headingDegrees));
  state.speed = speed;
  return state;
}

/** A river 20 m wide flowing south along x = 40, under the fixture's east-west road. */
const river: RiverDefinition = {
  id: 'test_river',
  widthMeters: 20,
  points: [
    [40, 200],
    [40, 0],
    [40, -200],
  ],
};
const opening = river.widthMeters / 2 + RIVER_BANK_METERS;

describe('RiverPath', () => {
  const path = new RiverPath(river);

  it('follows its course from the source, with its opening the water and both banks', () => {
    expect(path.x(0)).toBeCloseTo(40, 6);
    expect(path.z(0)).toBeCloseTo(200, 6);
    expect(path.lengthMeters).toBeCloseTo(400, 3);
    expect(path.openingHalfWidthMeters).toBeCloseTo(opening, 9);
    expect(path.distanceTo(50, 17)).toBeCloseTo(10, 6);
    expect(path.contains(40 + opening - 0.1, 0)).toBe(true);
    expect(path.contains(40 + opening + 0.1, 0)).toBe(false);
    expect(path.contains(40 + opening + 2, 0, 3)).toBe(true);
    // Far from it, nothing is filed: not water.
    expect(path.distanceTo(-150, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(path.directionZ(10)).toBeCloseTo(-1, 6);
  });

  it('runs deep inland and comes up to the sea at its mouth', () => {
    expect(path.mouthIndex).toBe(path.pointCount);
    expect([...path.depths].every((depth) => depth === 1)).toBe(true);

    // Flowing west into a sea whose shore runs along x = -100.
    const shoreline = seaFixture().shoreline;
    const estuary = new RiverPath(
      {
        id: 'estuary',
        widthMeters: 20,
        points: [
          [150, 30],
          [0, 30],
          [-190, 30],
        ],
      },
      shoreline,
    );
    const mouth = estuary.mouthIndex;
    expect(mouth).toBeLessThan(estuary.pointCount);
    expect(estuary.depths[0]).toBe(1);
    expect(estuary.depths[mouth]).toBe(0);
    expect(estuary.depths[mouth - 1]!).toBeLessThan(0.2);
    for (let i = 1; i < estuary.pointCount; i++) {
      expect(estuary.depths[i]!).toBeLessThanOrEqual(estuary.depths[i - 1]!);
    }
  });
});

describe('a river under a road', () => {
  const world = new DrivingWorld(mapFixture({ rivers: [river] }));
  const bridge = world.bridges[0]!;
  const road = world.roads[0]!;

  it('is crossed on a bridge whose deck reaches past the channel onto the land', () => {
    expect(world.bridges).toHaveLength(1);
    expect(bridge.roadIndex).toBe(0);
    expect(bridge.riverIndex).toBe(0);
    // The road runs east from x = -150: the opening spans x = 40 ± its half-width. The deck reaches at least an
    // abutment's length past it, and at most one of the road's samples (5 m apart here) more.
    expect(bridge.fromMeters).toBeLessThanOrEqual(190 - opening - BRIDGE_ABUTMENT_METERS);
    expect(bridge.fromMeters).toBeGreaterThan(190 - opening - BRIDGE_ABUTMENT_METERS - 6);
    expect(bridge.toMeters).toBeGreaterThanOrEqual(190 + opening + BRIDGE_ABUTMENT_METERS);
    expect(bridge.toMeters).toBeLessThan(190 + opening + BRIDGE_ABUTMENT_METERS + 6);
    expect(bridge.halfWidthMeters).toBeCloseTo(road.widthMeters / 2 + BRIDGE_KERB_METERS, 9);
    expect(Math.abs(bridge.x - 40)).toBeLessThan(4);
    expect(bridge.heading).toBeCloseTo(degrees(90), 6);
  });

  it('is water in its channel, and keeps the scenery off it', () => {
    expect(world.isWater(40, 60)).toBe(true);
    expect(world.isRiver(40 + opening - 1, 60)).toBe(true);
    expect(world.isWater(40 + opening + 1, 60)).toBe(false);
    expect(world.isWater(40 + opening + 1, 60, 2)).toBe(true);
  });

  it('lets a truck drive across on its bridge, along the road', () => {
    for (let x = 0; x <= 80; x += 2) {
      // In the eastbound lane (traffic keeps right: south of the centreline).
      const state = truckAt(x, -2.5, 90, 15);
      expect(world.resolveCollisions(state, footprint), `at x = ${x}`).toBe(0);
    }
  });

  it('stops a truck driving off the road into it, at the bank', () => {
    // On the grass 30 m north of the road, heading east at the river: the front circle 0.3 m into the bank's rim.
    const state = truckAt(0, 30, 90, 10);
    state.x = 40 - opening - (front + footprint.radius + 0.2 - 0.3);
    expect(world.resolveCollisions(state, footprint)).toBeCloseTo(10, 6);
    expect(Math.abs(state.speed)).toBeLessThan(1e-6);
    // Its front stays on the land.
    expect(state.x + front + footprint.radius).toBeLessThanOrEqual(40 - opening + 1e-6);
  });

  it('stops a truck steering off the deck at the parapet', () => {
    // On the deck, over the water, heading north at the northern parapet.
    const state = truckAt(40, 0, 0, 8);
    state.z = bridge.halfWidthMeters - (front + footprint.radius + 0.2 - 0.3);
    expect(world.resolveCollisions(state, footprint)).toBeCloseTo(8, 6);
    // Stopped, bounced back no more than a tenth of the way.
    expect(state.speed).toBeLessThanOrEqual(0);
    expect(state.speed).toBeGreaterThan(-0.8 - 1e-6);
    expect(state.z + front + footprint.radius).toBeLessThanOrEqual(bridge.halfWidthMeters + 1e-6);
  });

  it('is not bridged where no road crosses it', () => {
    const apart = new DrivingWorld(
      mapFixture({ rivers: [{ id: 'apart', widthMeters: 20, points: [[-190, 100], [190, 100]] }] }),
    );
    expect(apart.bridges).toHaveLength(0);
    expect(apart.isRiver(0, 100)).toBe(true);
  });
});

describe('the shipped region', () => {
  const world = new DrivingWorld(MAPS[0]!);

  it('bridges its river where the highway and the country roads to Amberfield and Copperdale cross it', () => {
    expect(world.rivers).toHaveLength(1);
    expect(world.bridges.map((bridge) => world.roads[bridge.roadIndex]!.id).sort()).toEqual(['highway_a_b', 'rural_a_c', 'rural_a_d']);
    for (const bridge of world.bridges) {
      expect(bridge.toMeters - bridge.fromMeters).toBeLessThan(70);
    }
  });

  it('keeps its trees, lamps, rocks and poles off the river', () => {
    const [kestrel] = world.rivers;
    const solid = [...world.trees, ...world.streetLamps, ...world.rocks, ...world.powerLines.flatMap((line) => line.poles)];
    for (const thing of solid) {
      expect(kestrel!.contains(thing.x, thing.z, 1), `${thing.x}, ${thing.z}`).toBe(false);
    }
  });
});
