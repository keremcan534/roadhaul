import { describe, expect, it } from 'vitest';
import type { MapDefinition, RiverDefinition } from '../../../../src/data/definitions/MapDefinition';
import type { SolidContact } from '../../../../src/domain/crash/DebrisSimulation';
import { KNOCKABLES, knockableCode } from '../../../../src/domain/crash/knockables';
import { VehicleDynamics } from '../../../../src/domain/vehicles/VehicleDynamics';
import { createVehicleFootprint } from '../../../../src/domain/vehicles/VehicleFootprint';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { mapFixture, seaFixture, vehicleFixture } from '../../../support/contentFixtures';

const truck = vehicleFixture();
const footprint = createVehicleFootprint(truck.body);
/** Centre of the front footprint circle, meters ahead of the rear axle. */
const front = Math.max(...footprint.offsets);

/** A truck driving straight at the thing at (x, z) across the street at `speed`, its front circle 0.2 m into the thing's. */
function drivingInto(thing: { x: number; z: number; radius: number }, speed: number) {
  // From the street's side: north (+z) toward one south of it, south toward one north of it.
  const heading = thing.z > 0 ? 0 : Math.PI;
  const reach = front + footprint.radius + thing.radius - 0.2;
  const state = new VehicleDynamics(truck).createState(thing.x, thing.z - Math.cos(heading) * reach, heading);
  state.speed = speed;
  return state;
}

/** The fixture's street (along z = 0, x -150..150) lit every 20 m, with its pavements and their furniture. */
const STREET: MapDefinition = mapFixture({
  scenery: { seed: 1, treesPerKilometer: 0, streetLampSpacingMeters: 20, streetscape: true },
});

describe('knocking things over', () => {
  it('knocks a lamp post over when the truck drives into it fast enough: the truck drives on, and the lamp is noted', () => {
    const world = new DrivingWorld(STREET);
    const lamp = world.streetLamps[0]!;
    const circle = world.circleIndexOf(lamp);
    expect(circle).toBeGreaterThanOrEqual(0);
    expect(world.circleThing(circle)).toBe(lamp);
    expect(world.circleKind[circle]).toBe(knockableCode('lamp'));
    const state = drivingInto(lamp, 8);
    const version = world.knockVersion;

    expect(world.resolveCollisions(state, footprint, null, true)).toBe(0);
    expect(state.speed).toBe(8);
    expect(world.knocked[circle]).toBe(1);
    expect(world.knockVersion).toBe(version + 1);
    const { knocks } = world;
    expect(knocks.count).toBe(1);
    expect([knocks.circle[0], knocks.vehicle[0], knocks.byDebris[0]]).toEqual([circle, -1, 0]);
    expect(knocks.speed[0]).toBeCloseTo(8, 1);
    // The normal points from the lamp back to the truck.
    expect(knocks.normalZ[0]! * Math.cos(state.heading)).toBeLessThan(-0.99);

    // Lying knocked over, it is in nobody's way.
    state.speed = 1;
    expect(world.resolveCollisions(state, footprint, null, true)).toBe(0);
    expect(knocks.count).toBe(0);
  });

  it('stands like anything solid when driven into slower than it gives way, or without knock-overs', () => {
    const world = new DrivingWorld(STREET);
    const lamp = world.streetLamps[0]!;
    const slow = drivingInto(lamp, KNOCKABLES.lamp.knockSpeed - 1);
    expect(world.resolveCollisions(slow, footprint, null, true)).toBeGreaterThan(3);
    expect(Math.abs(slow.speed)).toBeLessThan(1);

    const fast = drivingInto(lamp, 12);
    expect(world.resolveCollisions(fast, footprint)).toBeGreaterThan(11);
    expect(Math.abs(fast.speed)).toBeLessThan(1);
    expect(world.knocked.includes(1)).toBe(false);
    expect(world.knocks.count).toBe(0);
  });

  it('gives way by kind: a bin to a walking pace, a bus shelter only to a harder knock', () => {
    const world = new DrivingWorld(STREET);
    const bin = world.streetFurniture.find((item) => item.kind === 'bin')!;
    const shelter = world.streetFurniture.find((item) => item.kind === 'busStop')!;

    expect(world.resolveCollisions(drivingInto(bin, 2), footprint, null, true)).toBe(0);
    expect(world.knocked[world.circleIndexOf(bin)]).toBe(1);
    expect(world.resolveCollisions(drivingInto(shelter, 3), footprint, null, true)).toBeGreaterThan(2);
    expect(world.knocked[world.circleIndexOf(shelter)]).toBe(0);
    expect(world.resolveCollisions(drivingInto(shelter, 5), footprint, null, true)).toBe(0);
    expect(world.knocked[world.circleIndexOf(shelter)]).toBe(1);
  });

  it('stands what was knocked over back up where it stood', () => {
    const world = new DrivingWorld(STREET);
    const [first, second] = world.streetLamps;
    world.resolveCollisions(drivingInto(first!, 8), footprint, null, true);
    world.resolveCollisions(drivingInto(second!, 8), footprint, null, true);
    const version = world.knockVersion;

    world.restore(world.circleIndexOf(first!));
    expect(world.knocked[world.circleIndexOf(first!)]).toBe(0);
    expect(world.knocked[world.circleIndexOf(second!)]).toBe(1);
    expect(world.knockVersion).toBe(version + 1);
    // Solid again.
    expect(world.resolveCollisions(drivingInto(first!, 4), footprint, null, true)).toBeGreaterThan(3);

    world.restoreAll();
    expect(world.knocked.includes(1)).toBe(false);
    expect(world.knockVersion).toBe(version + 2);
    // Nothing left to stand up: no change to catch up with.
    world.restoreAll();
    expect(world.knockVersion).toBe(version + 2);
  });

  it('finds no circle for what cannot be knocked over', () => {
    const world = new DrivingWorld(mapFixture({ scenery: { seed: 1, treesPerKilometer: 20 } }));
    expect(world.trees.length).toBeGreaterThan(0);
    expect(world.circleIndexOf(world.trees[0]!)).toBe(-1);
    expect(() => world.circleThing(1e6)).toThrow();
  });
});

describe('debris against the world', () => {
  const contact: SolidContact = { normalX: 0, normalZ: 0, depth: 0 };

  it('bounces off trees, out along the line from the trunk', () => {
    const world = new DrivingWorld(mapFixture({ scenery: { seed: 1, treesPerKilometer: 20 } }));
    const tree = world.trees[0]!;
    // Half a meter across, 0.3 m into the trunk from the east.
    const x = tree.x + tree.radius + 0.5 - 0.3;

    expect(world.collideDebris(x, tree.z, 0.5, -5, 0, contact)).toBe(true);
    expect(contact.normalX).toBeCloseTo(1, 9);
    expect(contact.normalZ).toBeCloseTo(0, 9);
    expect(contact.depth).toBeCloseTo(0.3, 9);
    expect(world.collideDebris(x + 1, tree.z, 0.5, -5, 0, contact)).toBe(false);
  });

  it('bounces off buildings, out through the nearest side even from inside', () => {
    // The fixture's building: x -10..10, z 35..45.
    const world = new DrivingWorld(mapFixture());
    expect(world.collideDebris(0, 34.5, 1, 0, 3, contact)).toBe(true);
    expect([contact.normalX, contact.normalZ]).toEqual([0, -1]);
    expect(contact.depth).toBeCloseTo(0.5, 9);

    expect(world.collideDebris(-8, 41, 1, 0, 0, contact)).toBe(true);
    expect([contact.normalX, contact.normalZ]).toEqual([-1, 0]);
    expect(contact.depth).toBeCloseTo(3, 9);
  });

  it('keeps debris on the map', () => {
    // The fixture's map ends 200 m out.
    const world = new DrivingWorld(mapFixture());
    expect(world.collideDebris(199.5, -100, 1, 9, 0, contact)).toBe(true);
    expect([contact.normalX, contact.normalZ]).toEqual([-1, 0]);
    expect(contact.depth).toBeCloseTo(0.5, 9);
    expect(world.collideDebris(-100, -199.8, 1, 0, 0, contact)).toBe(true);
    expect([contact.normalX, contact.normalZ]).toEqual([0, 1]);
    expect(world.collideDebris(-100, -100, 1, 0, 0, contact)).toBe(false);
  });

  it('knocks over what gives way to it as hard as to the truck, and lets itself through', () => {
    const world = new DrivingWorld(STREET);
    const bin = world.streetFurniture.find((item) => item.kind === 'bin')!;
    const circle = world.circleIndexOf(bin);
    // Flying west into it, from its east.
    const x = bin.x + bin.radius + 0.4 - 0.1;

    expect(world.collideDebris(x, bin.z, 0.4, -1, 0, contact)).toBe(true);
    expect(world.knocked[circle]).toBe(0);
    expect(world.collideDebris(x, bin.z, 0.4, -6, 0, contact)).toBe(false);
    expect(world.knocked[circle]).toBe(1);
    const { knocks } = world;
    expect(knocks.count).toBe(1);
    expect([knocks.circle[0], knocks.byDebris[0]]).toEqual([circle, 1]);
    expect(knocks.speed[0]).toBeCloseTo(6, 6);
    expect(knocks.normalX[0]).toBeCloseTo(1, 6);
    // Lying knocked over, it is in nobody's way.
    expect(world.collideDebris(x, bin.z, 0.4, -1, 0, contact)).toBe(false);
  });
});

describe('the ground debris lands on', () => {
  it('is everywhere but the sea and the rivers, and on the bridges over them', () => {
    const river: RiverDefinition = {
      id: 'test_river',
      widthMeters: 20,
      points: [
        [40, 200],
        [40, 0],
        [40, -200],
      ],
    };
    const world = new DrivingWorld(mapFixture({ rivers: [river], sea: seaFixture() }));
    expect(world.hasGround(0, 60)).toBe(true);
    expect(world.hasGround(-190, 60)).toBe(false);
    expect(world.hasGround(40, 60)).toBe(false);
    // The road crosses the river on a bridge along z = 0.
    expect(world.isOnBridge(40, 0)).toBe(true);
    expect(world.hasGround(40, 0)).toBe(true);
    expect(world.hasGround(40, world.bridges[0]!.halfWidthMeters + 0.5)).toBe(false);
  });
});
