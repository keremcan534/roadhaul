import { describe, expect, it } from 'vitest';
import { GAME_CONTENT } from '../../../../src/data/content';
import type { Point2 } from '../../../../src/data/definitions/MapDefinition';
import { createManoeuvre, nextManoeuvre } from '../../../../src/domain/navigation/manoeuvre';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { createRouteTrace, RoadNetwork } from '../../../../src/domain/world/RoadNetwork';
import { RoadPath } from '../../../../src/domain/world/RoadPath';

function road(id: string, controlPoints: readonly Point2[]): RoadPath {
  return new RoadPath({ id, kind: 'street', widthMeters: 10, closed: false, controlPoints });
}

// A street north from the origin to a T junction at (0, 200): one arm goes -X, the other +X; a fourth road carries on north.
const trunk = road('trunk', [
  [0, 0],
  [0, 100],
  [0, 200],
]);
const towardMinusX = road('minus_x', [
  [0, 200],
  [-100, 200],
  [-200, 200],
]);
const towardPlusX = road('plus_x', [
  [0, 200],
  [100, 200],
  [200, 200],
]);
const onward = road('onward', [
  [0, 200],
  [0, 300],
  [0, 400],
]);
const network = new RoadNetwork([trunk, towardMinusX, towardPlusX, onward]);
const paces = [10, 10, 10, 10];
const NORTH = 0;
const SOUTH = Math.PI;

function manoeuvreFor(fromX: number, fromZ: number, heading: number, toX: number, toZ: number, onRoad = true) {
  const trace = network.trace(fromX, fromZ, toX, toZ, paces, createRouteTrace(network));
  return { trace, manoeuvre: nextManoeuvre(trace, heading, onRoad, createManoeuvre()) };
}

describe('RoadNetwork.trace', () => {
  it('lists the route sample by sample, with its length and how long it takes at each road\'s pace', () => {
    const { trace } = manoeuvreFor(0, 10, NORTH, -150, 203);

    expect(trace.connected).toBe(true);
    // From the sample nearest the start (samples are about 4 m apart) to the one nearest the target.
    const last = trace.count - 1;
    expect(trace.x[0]).toBeCloseTo(0, 6);
    expect(Math.abs(trace.z[0]! - 10)).toBeLessThan(2.5);
    expect(Math.abs(trace.x[last]! + 150)).toBeLessThan(2.5);
    // At the junction the route steps between the two roads' samples there, which share a position.
    for (let i = 1; i < trace.count; i++) {
      expect(trace.along[i]).toBeGreaterThanOrEqual(trace.along[i - 1]!);
    }
    // About 190 m north and 150 m west by road, then 3 m off the road to the target.
    const byRoad = trace.along[last]!;
    expect(byRoad).toBeGreaterThan(335);
    expect(byRoad).toBeLessThan(345);
    const offRoad = Math.hypot(trace.x[0]!, trace.z[0]! - 10) + Math.hypot(trace.x[last]! + 150, trace.z[last]! - 203);
    expect(trace.distanceMeters).toBeCloseTo(byRoad + offRoad, 6);
    // 10 m/s along the roads, walking pace (4 m/s) for the bits off them.
    expect(trace.seconds).toBeCloseTo(byRoad / 10 + offRoad / 4, 6);
    expect(new Set(trace.road.subarray(0, trace.count))).toEqual(new Set([0, 1]));
  });

  it('falls back to a straight line when no road joins the two ends', () => {
    const lonely = new RoadNetwork([trunk, road('island', [[500, 0], [600, 0]])]);
    const trace = lonely.trace(0, 50, 550, 0, [10, 10], createRouteTrace(lonely));

    expect(trace.connected).toBe(false);
    expect(trace.count).toBe(0);
    expect(trace.distanceMeters).toBeCloseTo(Math.hypot(550, 50), 6);
  });
});

describe('nextManoeuvre', () => {
  it('turns right onto a road heading off to the right, and left onto one to the left', () => {
    // Heading +Z, the driver's right is -X.
    const right = manoeuvreFor(0, 10, NORTH, -150, 200).manoeuvre;
    const left = manoeuvreFor(0, 10, NORTH, 150, 200).manoeuvre;

    expect(right.kind).toBe('right');
    expect(left.kind).toBe('left');
    expect(right.distanceMeters).toBeGreaterThan(185);
    expect(right.distanceMeters).toBeLessThan(195);
  });

  it('says nothing about carrying straight on across a junction: the next thing is arriving', () => {
    const { trace, manoeuvre } = manoeuvreFor(0, 10, NORTH, 0, 380);

    expect(manoeuvre.kind).toBe('arrive');
    expect(manoeuvre.distanceMeters).toBe(trace.distanceMeters);
  });

  it('asks a truck on the road facing away from the route to turn round, but not one off the road', () => {
    expect(manoeuvreFor(0, 100, SOUTH, -150, 200).manoeuvre).toEqual({ kind: 'turnAround', distanceMeters: 0 });
    expect(manoeuvreFor(0, 100, SOUTH, -150, 200, false).manoeuvre.kind).toBe('right');
  });

  it('turns left at the high street crossing on the way from Yeniliman to Demirkent', () => {
    const world = new DrivingWorld(GAME_CONTENT.maps[0]!);
    const from = world.depotOf('city_a')!.bay;
    const to = world.depotOf('city_b')!.bay;
    const regionPaces = world.roads.map(() => 12);
    const trace = world.network.trace(from.x, from.z, to.x, to.z, regionPaces, createRouteTrace(world.network));

    // Out of the yard onto the high street heading north (+Z), then left (+X) onto the harbour road at 200 m.
    const first = nextManoeuvre(trace, (from.headingDegrees * Math.PI) / 180, false, createManoeuvre());
    expect(first.kind).toBe('left');
    expect(first.distanceMeters).toBeGreaterThan(180);
    expect(first.distanceMeters).toBeLessThan(215);
    expect(trace.distanceMeters).toBeGreaterThan(4000);
    // 12 m/s on the road; the bits in the two yards go slower.
    expect(trace.seconds).toBeGreaterThan(trace.distanceMeters / 12);
    expect(trace.seconds).toBeLessThan(trace.distanceMeters / 12 + 20);
  });
});
