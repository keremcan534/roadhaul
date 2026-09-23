import { describe, expect, it } from 'vitest';
import type { RoadDefinition } from '../../../../src/data/definitions/MapDefinition';
import { RoadPath } from '../../../../src/domain/world/RoadPath';
import {
  createRouteGuidance,
  ROUTE_LOOK_AHEAD_METERS,
  routeAlongRoads,
} from '../../../../src/domain/world/roadRoute';

// A 200 m square loop centred on the origin, 8 m wide, with a control point
// every 50 m so the sides are straight (only the corners are rounded).
const side = [-100, -50, 0, 50];
const loop = new RoadPath({
  id: 'loop',
  widthMeters: 8,
  closed: true,
  controlPoints: [
    ...side.map((x): [number, number] => [x, -100]),
    ...side.map((z): [number, number] => [100, z]),
    ...side.map((x): [number, number] => [-x, 100]),
    ...side.map((z): [number, number] => [-100, -z]),
  ],
} satisfies RoadDefinition);
const island = new RoadPath({
  id: 'island',
  widthMeters: 8,
  closed: false,
  controlPoints: [
    [300, 0],
    [400, 0],
  ],
} satisfies RoadDefinition);

describe('routeAlongRoads', () => {
  it('follows the road the shorter way and aims ahead along it', () => {
    // From the middle of the south side to 20 m beside the east side's middle.
    const route = routeAlongRoads([loop], 0, -100, 120, 0, createRouteGuidance());

    // About a quarter of the loop plus the 20 m off the road.
    expect(route.distanceMeters).toBeGreaterThan(190);
    expect(route.distanceMeters).toBeLessThan(260);
    // The aim point is on the road, heading east, about the look-ahead away.
    expect(route.aimZ).toBeCloseTo(-100, 0);
    expect(route.aimX).toBeGreaterThan(ROUTE_LOOK_AHEAD_METERS - 5);
    expect(route.aimX).toBeLessThan(ROUTE_LOOK_AHEAD_METERS + 5);
  });

  it('turns back when the target is behind, the short way round', () => {
    const route = routeAlongRoads([loop], 0, -100, -120, 0, createRouteGuidance());

    expect(route.aimX).toBeLessThan(-ROUTE_LOOK_AHEAD_METERS + 5);
  });

  it('heads straight for a target that is close by road', () => {
    const route = routeAlongRoads([loop], 0, -100, 10, -120, createRouteGuidance());

    expect(route.distanceMeters).toBeCloseTo(Math.hypot(10, 20), 9);
    expect([route.aimX, route.aimZ]).toEqual([10, -120]);
  });

  it('falls back to a straight line between different roads, or without roads', () => {
    const between = routeAlongRoads([loop, island], 0, -100, 350, 0, createRouteGuidance());
    const nowhere = routeAlongRoads([], 0, 0, 30, 40, createRouteGuidance());

    expect(between.distanceMeters).toBeCloseTo(Math.hypot(350, 100), 9);
    expect([between.aimX, between.aimZ]).toEqual([350, 0]);
    expect(nowhere.distanceMeters).toBe(50);
  });

  it('reuses the object it is given', () => {
    const out = createRouteGuidance();

    expect(routeAlongRoads([loop], 0, -100, 120, 0, out)).toBe(out);
  });
});
