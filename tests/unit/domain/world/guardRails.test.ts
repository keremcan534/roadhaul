import { describe, expect, it } from 'vitest';
import type { RoadDefinition } from '../../../../src/data/definitions/MapDefinition';
import { GUARD_RAIL_OUT_METERS, GUARD_RAIL_POST_SPACING_METERS, placeGuardRails } from '../../../../src/domain/world/guardRails';
import { RoadPath } from '../../../../src/domain/world/RoadPath';

/**
 * A country road along +x on z = 0, then round a bend of 80 m radius (its
 * centre at (0, 80)) to +z. Control points about 40 m apart all along, so
 * the curve through them keeps to the arc.
 */
const bend: RoadDefinition = {
  id: 'bend',
  kind: 'rural',
  widthMeters: 8,
  closed: false,
  controlPoints: [
    ...Array.from({ length: 6 }, (_, index): [number, number] => [-200 + index * 40, 0]),
    [40, 10.72],
    [69.28, 40],
    ...Array.from({ length: 6 }, (_, index): [number, number] => [80, 80 + index * 40]),
  ],
};

const everywhere = (): boolean => true;

describe('placeGuardRails', () => {
  it('lines the outside of a sharp bend, beyond the asphalt, and leaves the straights bare', () => {
    const road = new RoadPath(bend);
    const rails = placeGuardRails([road], everywhere);

    expect(rails).toHaveLength(1);
    const rail = rails[0]!;
    // On the outside of the bend, away from its centre.
    for (const [x, z] of rail.points) {
      expect(road.distanceTo(x, z) - bend.widthMeters / 2).toBeCloseTo(GUARD_RAIL_OUT_METERS, 0);
      expect(Math.hypot(x, z - 80)).toBeGreaterThan(80);
    }
    // It runs on past the bend, but not down the straights.
    const xs = rail.points.map(([x]) => x);
    const zs = rail.points.map(([, z]) => z);
    expect(Math.min(...xs)).toBeLessThan(-5);
    expect(Math.min(...xs)).toBeGreaterThan(-50);
    expect(Math.max(...zs)).toBeGreaterThan(85);
    expect(Math.max(...zs)).toBeLessThan(130);
    // Posts evenly spaced along the road: a little further apart round the outside of the bend, a little
    // closer where the curve through the control points wavers the other way.
    for (let index = 1; index < rail.points.length; index++) {
      const [ax, az] = rail.points[index - 1]!;
      const [bx, bz] = rail.points[index]!;
      expect(Math.hypot(bx - ax, bz - az)).toBeGreaterThan(GUARD_RAIL_POST_SPACING_METERS * 0.97);
      expect(Math.hypot(bx - ax, bz - az)).toBeLessThan(GUARD_RAIL_POST_SPACING_METERS * 1.1);
    }
  });

  it('tells which side of the rail the road is on', () => {
    const [rail] = placeGuardRails([new RoadPath(bend)], everywhere);
    const [ax, az] = rail!.points[0]!;
    const [bx, bz] = rail!.points[1]!;
    // Left of the rail's run is (dz, -dx); the road's centreline lies to one side.
    const leftX = bz - az;
    const leftZ = -(bx - ax);
    const road = new RoadPath(bend);
    const towardLeft = road.distanceTo(ax + leftX, az + leftZ) < road.distanceTo(ax - leftX, az - leftZ);
    expect(rail!.roadSide).toBe(towardLeft ? 'left' : 'right');
  });

  it('breaks a rail where a post may not stand, and leaves out what is left too short', () => {
    const road = new RoadPath(bend);
    const [whole] = placeGuardRails([road], everywhere);
    // A gap in the middle of the bend: two rails either side of it.
    const gap = (x: number, z: number): boolean => Math.hypot(x - 60, z - 22) > 6;
    const broken = placeGuardRails([road], gap);
    expect(broken).toHaveLength(2);
    expect(broken[0]!.points.length + broken[1]!.points.length).toBeLessThan(whole!.points.length);
    // Most of it forbidden: nothing long enough is left.
    const nearlyNothing = (x: number, z: number): boolean => Math.hypot(x - 60, z - 22) < 8;
    expect(placeGuardRails([road], nearlyNothing)).toHaveLength(0);
  });

  it('rails no city street, and no gentle bend', () => {
    expect(placeGuardRails([new RoadPath({ ...bend, kind: 'street' })], everywhere)).toHaveLength(0);
    const gentle: RoadDefinition = {
      ...bend,
      controlPoints: [
        [-400, 0],
        [0, 0],
        [400, 20],
        [800, 60],
      ],
    };
    expect(placeGuardRails([new RoadPath(gentle)], everywhere)).toHaveLength(0);
  });

  it('is the same every time', () => {
    const road = new RoadPath(bend);
    expect(placeGuardRails([road], everywhere)).toEqual(placeGuardRails([road], everywhere));
  });
});
