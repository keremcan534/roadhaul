import { describe, expect, it } from 'vitest';
import type { Point2, RoadKind } from '../../../../src/data/definitions/MapDefinition';
import { Occupancy } from '../../../../src/domain/world/countryside';
import { RoadNetwork } from '../../../../src/domain/world/RoadNetwork';
import { RoadPath } from '../../../../src/domain/world/RoadPath';
import {
  FENCE_POST_SPACING_METERS,
  GATE_PILLAR_RADIUS_METERS,
  HEDGE_STEP_METERS,
  placeFarmGates,
  placeHedgerows,
  placeRoadFences,
  type RoadsideGround,
} from '../../../../src/domain/world/roadsides';

function road(id: string, kind: RoadKind, controlPoints: Point2[], widthMeters = 8): RoadPath {
  return new RoadPath({ id, kind, widthMeters, closed: false, controlPoints });
}

/** Open country round `roads`: clear four meters off every road (a meter beside them), but where `blocked` says. */
function ground(roads: RoadPath[], blocked: (x: number, z: number) => boolean = () => false): RoadsideGround {
  const off = (x: number, z: number, margin: number): boolean => roads.every((candidate) => candidate.distanceTo(x, z) > candidate.widthMeters / 2 + margin);
  return {
    roads,
    fields: [],
    network: new RoadNetwork(roads),
    isClear: (x, z) => !blocked(x, z) && off(x, z, 4),
    isClearBeside: (x, z) => !blocked(x, z) && off(x, z, 1),
    nearRoad: (x, z, clearance) => !off(x, z, clearance),
  };
}

/** A country road along z = 0, 1200 m long. */
const country = road('country', 'rural', [
  [-600, 0],
  [0, 0],
  [600, 0],
]);

describe('placeHedgerows', () => {
  it('grows hedges along both sides of a country road, a point every few meters, a little way out', () => {
    const hedges = placeHedgerows(ground([country]), new Occupancy(), 7);

    expect(hedges.length).toBeGreaterThan(2);
    const sides = new Set<number>();
    for (const { points } of hedges) {
      expect(points.length).toBeGreaterThanOrEqual(7);
      for (const [x, z] of points) {
        expect(Math.abs(z)).toBeGreaterThanOrEqual(4 + 9 - 0.01);
        expect(Math.abs(z)).toBeLessThanOrEqual(4 + 11 + 0.01);
        expect(Math.abs(x)).toBeLessThanOrEqual(600 - 30 + 0.01);
        sides.add(Math.sign(z));
      }
      for (let i = 1; i < points.length; i++) {
        const [ax, az] = points[i - 1]!;
        const [bx, bz] = points[i]!;
        expect(Math.hypot(bx - ax, bz - az)).toBeCloseTo(HEDGE_STEP_METERS, 1);
      }
    }
    expect([...sides].sort()).toEqual([-1, 1]);
    // A good share of the road's length is hedged, each side, not all of it.
    const hedged = hedges.reduce((sum, { points }) => sum + (points.length - 1) * HEDGE_STEP_METERS, 0);
    expect(hedged).toBeGreaterThan(0.3 * 2 * 1200);
    expect(hedged).toBeLessThan(0.9 * 2 * 1200);
  });

  it('grows the same hedges from the same seed, other ones from another', () => {
    const first = placeHedgerows(ground([country]), new Occupancy(), 7);

    expect(placeHedgerows(ground([country]), new Occupancy(), 7)).toEqual(first);
    expect(placeHedgerows(ground([country]), new Occupancy(), 8)).not.toEqual(first);
  });

  it('breaks round what stands and where the ground is taken, and keeps clear of junctions', () => {
    const lane = road('lane', 'lane', [
      [0, 0],
      [0, 300],
    ], 5.5);
    const occupancy = new Occupancy();
    for (let x = -600; x <= 600; x += 20) {
      occupancy.add(x, 14, 0.3);
    }
    const hedges = placeHedgerows(ground([country, lane], (x, z) => z < 0 && x > 0), occupancy, 7);

    for (const { points } of hedges.filter(({ points }) => Math.abs(points[0]![1]) < 20)) {
      for (const [x, z] of points) {
        // Nothing on the taken ground, nothing within reach of the posts every 20 m, nothing by the junction.
        expect(z < 0 && x > 0).toBe(false);
        expect(Math.hypot(x - Math.round(x / 20) * 20, z - 14)).toBeGreaterThan(0.9);
        expect(Math.abs(x)).toBeGreaterThan(30 - 4 - 0.01);
      }
    }
  });

  it('grows none along the highway or the towns\' streets', () => {
    const highway = road('highway', 'highway', [
      [-600, 0],
      [600, 0],
    ], 14);
    const street = road('street', 'street', [
      [-600, 100],
      [600, 100],
    ], 10);

    expect(placeHedgerows(ground([highway, street]), new Occupancy(), 7)).toEqual([]);
  });
});

describe('placeFarmGates', () => {
  it('stands pillars either side of a farm lane just in from its road, and a mailbox on the right as it is entered, facing the road', () => {
    // A lane north off the country road to a farm (its far end a dead end).
    const lane = road('farm_lane', 'lane', [
      [0, 0],
      [0, 400],
    ], 5.5);
    const occupancy = new Occupancy();

    const gates = placeFarmGates(ground([country, lane]), occupancy);

    expect(gates).toHaveLength(1);
    const [gate] = gates;
    // Into the lane is +z; its right is -x.
    expect(gate!.heading).toBeCloseTo(0, 5);
    const [right, left] = gate!.pillars;
    expect(right.x).toBeCloseTo(-(2.75 + 1.2), 3);
    expect(left.x).toBeCloseTo(2.75 + 1.2, 3);
    expect(right.z).toBeCloseTo(4 + 7, 3);
    expect(right.radius).toBe(GATE_PILLAR_RADIUS_METERS);
    expect(gate!.mailbox.x).toBeLessThan(right.x);
    expect(gate!.mailbox.z).toBeLessThan(right.z);
    expect(Math.abs(Math.sin(gate!.mailbox.heading))).toBeLessThan(1e-6);
    expect(Math.cos(gate!.mailbox.heading)).toBeCloseTo(-1, 6);
    for (const thing of [right, left, gate!.mailbox]) {
      expect(occupancy.isFree(thing.x, thing.z, 0.01, 0)).toBe(false);
    }
  });

  it('puts no gate on a lane that joins a road at both ends, nor where the ground is taken', () => {
    const loop = road('loop_lane', 'lane', [
      [-200, 0],
      [-200, 200],
      [200, 200],
      [200, 0],
    ], 5.5);
    expect(placeFarmGates(ground([road('country', 'rural', [[-600, 0], [-200, 0], [200, 0], [600, 0]]), loop]), new Occupancy())).toEqual([]);

    const lane = road('farm_lane', 'lane', [
      [0, 0],
      [0, 400],
    ], 5.5);
    expect(placeFarmGates(ground([country, lane], (x, z) => Math.abs(x) < 6 && z > 0 && z < 20), new Occupancy())).toEqual([]);
  });
});

describe('placeRoadFences', () => {
  it('fences both sides of the highway a way out, a post every few meters, and nothing else', () => {
    const highway = road('highway', 'highway', [
      [-600, 0],
      [600, 0],
    ], 14);

    const elsewhere = road('elsewhere', 'rural', [
      [-600, 300],
      [600, 300],
    ]);
    const fences = placeRoadFences(ground([highway, elsewhere]), new Occupancy());

    expect(fences).toHaveLength(2);
    for (const { points } of fences) {
      expect((points.length - 1) * FENCE_POST_SPACING_METERS).toBeGreaterThan(1100);
      for (const [, z] of points) {
        expect(Math.abs(Math.abs(z) - (7 + 14))).toBeLessThan(0.01);
      }
    }
    expect(placeRoadFences(ground([country]), new Occupancy())).toEqual([]);
  });
});
