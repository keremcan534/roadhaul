import { describe, expect, it } from 'vitest';
import type { Point2, RoadDefinition } from '../../../../src/data/definitions/MapDefinition';
import { RoadNetwork } from '../../../../src/domain/world/RoadNetwork';
import { RoadPath } from '../../../../src/domain/world/RoadPath';
import { createRouteGuidance, ROUTE_LOOK_AHEAD_METERS } from '../../../../src/domain/world/roadRoute';

function road(id: string, controlPoints: readonly Point2[], closed = false): RoadPath {
  return new RoadPath({ id, kind: 'street', widthMeters: 8, closed, controlPoints } satisfies RoadDefinition);
}

// A 200 m square loop centred on the origin, with a control point every 50 m so
// the sides are straight (only the corners are rounded).
const side = [-100, -50, 0, 50];
const loop = road(
  'loop',
  [
    ...side.map((x): Point2 => [x, -100]),
    ...side.map((z): Point2 => [100, z]),
    ...side.map((x): Point2 => [-x, 100]),
    ...side.map((z): Point2 => [-100, -z]),
  ],
  true,
);
/** A spur east from the loop's east side, joined where it shares the loop's control point (100, 0). */
const spur = road('spur', [
  [100, 0],
  [200, 0],
  [300, 0],
]);
/** A road that starts 30 m past the spur's end: no junction, a separate network. */
const island = road('island', [
  [330, 0],
  [430, 0],
]);

describe('RoadNetwork', () => {
  it('follows a road the shorter way and aims ahead along it', () => {
    const network = new RoadNetwork([loop]);
    // From the middle of the south side to 20 m beside the east side's middle.
    const route = network.guide(0, -100, 120, 0, createRouteGuidance());

    // About a quarter of the loop plus the 20 m off the road.
    expect(route.distanceMeters).toBeGreaterThan(190);
    expect(route.distanceMeters).toBeLessThan(260);
    // The aim point is on the road, heading east, about the look-ahead away.
    expect(route.aimZ).toBeCloseTo(-100, 0);
    expect(route.aimX).toBeGreaterThan(ROUTE_LOOK_AHEAD_METERS - 5);
    expect(route.aimX).toBeLessThan(ROUTE_LOOK_AHEAD_METERS + 5);
  });

  it('turns back when the target is behind, the short way round', () => {
    const route = new RoadNetwork([loop]).guide(0, -100, -120, 0, createRouteGuidance());

    expect(route.aimX).toBeLessThan(-ROUTE_LOOK_AHEAD_METERS + 5);
  });

  it('heads straight for a target that is close by road', () => {
    const route = new RoadNetwork([loop]).guide(0, -100, 10, -120, createRouteGuidance());

    expect(route.distanceMeters).toBeCloseTo(Math.hypot(10, 20), 9);
    expect([route.aimX, route.aimZ]).toEqual([10, -120]);
  });

  it('crosses from one road to another where they share a control point', () => {
    const network = new RoadNetwork([loop, spur]);
    // From the loop's west side to the end of the spur: half the loop, then the spur.
    const route = network.guide(-100, 0, 300, 0, createRouteGuidance());

    expect(network.componentCount).toBe(1);
    expect(route.distanceMeters).toBeGreaterThan(300 + 200);
    expect(route.distanceMeters).toBeLessThan(300 + 330);
    // From the spur back to the loop's south side, the aim leads west along the spur.
    const back = network.guide(250, 0, 0, -100, createRouteGuidance());
    expect(back.aimX).toBeLessThan(250);
    expect(back.aimZ).toBeCloseTo(0, 0);
  });

  it('keeps roads that do not meet apart, and falls back to a straight line between them', () => {
    const network = new RoadNetwork([loop, spur, island]);
    const between = network.guide(0, -100, 400, 0, createRouteGuidance());
    const nowhere = new RoadNetwork([]).guide(0, 0, 30, 40, createRouteGuidance());

    expect(network.componentCount).toBe(2);
    expect(between.distanceMeters).toBeCloseTo(Math.hypot(400, 100), 9);
    expect([between.aimX, between.aimZ]).toEqual([400, 0]);
    expect(nowhere.distanceMeters).toBe(50);
  });

  it('never cuts across between two stretches of one road that pass close by', () => {
    // A hairpin: the way back runs 6 m from the way out.
    const hairpin = road('hairpin', [
      [0, 0],
      [100, 0],
      [110, 3],
      [100, 6],
      [0, 6],
    ]);
    const network = new RoadNetwork([hairpin]);

    const route = network.guide(0, 0, 0, 6, createRouteGuidance());

    expect(network.componentCount).toBe(1);
    // Round the hairpin, not across the 6 m of grass: the aim leads along the way out.
    expect(route.distanceMeters).toBeGreaterThan(200);
    expect(route.aimX).toBeGreaterThan(30);
    expect(route.aimZ).toBeCloseTo(0, 0);
  });

  it('reuses the object it is given, and the route to a target once computed', () => {
    const network = new RoadNetwork([loop, spur]);
    const out = createRouteGuidance();

    expect(network.guide(0, -100, 300, 0, out)).toBe(out);
    const first = out.distanceMeters;
    network.guide(0, -100, 300, 0, out);
    expect(out.distanceMeters).toBe(first);
  });
});
