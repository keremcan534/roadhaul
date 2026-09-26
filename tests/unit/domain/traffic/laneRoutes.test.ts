import { describe, expect, it } from 'vitest';
import { laneRouteTo } from '../../../../src/domain/traffic/laneRoutes';
import { crossingStreets, laneAt, laneGraphOf, successorsOf } from '../../../support/trafficFixtures';

describe('laneRouteTo', () => {
  // Beside the east arm of the crossing, on its north side: a depot's yard.
  const graph = laneGraphOf(crossingStreets());
  const route = laneRouteTo(graph, 150, 12, 10);
  const eastbound = laneAt(graph, 100, 0, 90);
  const westbound = laneAt(graph, 100, 0, -90);

  it('is reached level with the place on the lanes beside it, either way, and on no others', () => {
    const targets = Array.from(route.arriveAt.keys()).filter((link) => route.arriveAt[link]! >= 0);
    expect(new Set(targets)).toEqual(new Set([eastbound, westbound]));
    for (const lane of [eastbound, westbound]) {
      const first = graph.pointStart[lane]!;
      // Along X from the lane's first point: level with x = 150.
      expect(route.arriveAt[lane]).toBeCloseTo(Math.abs(150 - graph.pointX[first]!), 6);
      expect(route.distances[lane]).toBe(route.arriveAt[lane]);
    }
  });

  it('knows the way there from every lane: through each link to the nearest way on', () => {
    for (let link = 0; link < graph.linkCount; link++) {
      expect(Number.isFinite(route.distances[link]), `link ${link}`).toBe(true);
      if (route.arriveAt[link]! >= 0) {
        continue;
      }
      const onward = Math.min(...successorsOf(graph, link).map((next) => route.distances[next]!));
      expect(route.distances[link]).toBeCloseTo(graph.length[link]! + onward, 6);
    }
  });

  it('turns towards the place at the junction, and goes on round when it has passed', () => {
    const fromSouth = laneAt(graph, 0, -100, 0);
    const turns = successorsOf(graph, fromSouth);
    const best = turns.reduce((a, b) => (route.distances[b]! < route.distances[a]! ? b : a));
    expect(successorsOf(graph, best)).toEqual([eastbound]);
    // Past the place on the lane east, the way back comes round the dead end, into the lane west.
    const [uTurn] = successorsOf(graph, eastbound);
    expect(route.distances[uTurn!]).toBeCloseTo(graph.length[uTurn!]! + route.arriveAt[westbound]!, 6);
  });
});
