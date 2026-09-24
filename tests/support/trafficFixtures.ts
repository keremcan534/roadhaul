import type { Point2, RoadDefinition, RoadKind } from '../../src/data/definitions/MapDefinition';
import { LaneGraph } from '../../src/domain/traffic/LaneGraph';
import { DrivingWorld } from '../../src/domain/world/DrivingWorld';

/** Speed limits for traffic tests, m/s (the defaults, 45 / 60 / 90 / 70 km/h). */
export const TEST_SPEED_LIMITS: Readonly<Record<RoadKind, number>> = {
  street: 12.5,
  ringRoad: 60 / 3.6,
  highway: 25,
  rural: 70 / 3.6,
};

export function roadFixture(
  id: string,
  kind: RoadKind,
  widthMeters: number,
  controlPoints: readonly Point2[],
  closed = false,
): RoadDefinition {
  return { id, kind, widthMeters, closed, controlPoints };
}

/** A world of just `roads`: no scenery, depots or buildings. */
export function roadWorld(roads: readonly RoadDefinition[], halfSizeMeters = 1500): DrivingWorld {
  return new DrivingWorld({
    id: 'traffic_test',
    halfSizeMeters,
    roads,
    buildings: [],
    depots: [],
    restAreas: [],
    citySigns: [],
    fields: [],
    windTurbines: [],
    spawn: { x: 0, z: 0, headingDegrees: 0 },
    scenery: { seed: 1, treesPerKilometer: 0 },
  });
}

/** A straight street along +Z from z = -length/2 to +length/2, dead ends at both ends. */
export function straightStreet(lengthMeters = 400, kind: RoadKind = 'street', widthMeters = 10): DrivingWorld {
  const points: Point2[] = [];
  for (let z = -lengthMeters / 2; z <= lengthMeters / 2; z += 100) {
    points.push([0, z]);
  }
  return roadWorld([roadFixture('main', kind, widthMeters, points)]);
}

/** Two streets crossing at the origin: one along Z, one along X, each 400 m with dead ends. */
export function crossingStreets(): DrivingWorld {
  return roadWorld([
    roadFixture('north_south', 'street', 10, [
      [0, -200],
      [0, -100],
      [0, 0],
      [0, 100],
      [0, 200],
    ]),
    roadFixture('east_west', 'street', 10, [
      [-200, 0],
      [-100, 0],
      [0, 0],
      [100, 0],
      [200, 0],
    ]),
  ]);
}

export function laneGraphOf(world: DrivingWorld): LaneGraph {
  return new LaneGraph(world, TEST_SPEED_LIMITS);
}

/**
 * The lane link that passes closest to (x, z) heading within 30° of
 * `headingDegrees` (0 = +Z, 90 = +X). Throws when there is none.
 */
export function laneAt(graph: LaneGraph, x: number, z: number, headingDegrees: number, laneIndex = 0): number {
  const heading = (headingDegrees * Math.PI) / 180;
  let best = -1;
  let bestDistance = Infinity;
  for (let link = 0; link < graph.linkCount; link++) {
    if (graph.kindOf(link) !== 'lane' || graph.laneIndex[link] !== laneIndex) {
      continue;
    }
    for (let k = graph.pointStart[link]!; k < graph.pointStart[link + 1]! - 1; k++) {
      const direction = Math.atan2(graph.pointX[k + 1]! - graph.pointX[k]!, graph.pointZ[k + 1]! - graph.pointZ[k]!);
      let turn = direction - heading;
      turn -= Math.round(turn / (2 * Math.PI)) * 2 * Math.PI;
      const distance = Math.hypot(graph.pointX[k]! - x, graph.pointZ[k]! - z);
      if (Math.abs(turn) < Math.PI / 6 && distance < bestDistance) {
        bestDistance = distance;
        best = link;
      }
    }
  }
  if (best < 0) {
    throw new Error(`No lane near (${x}, ${z}) heading ${headingDegrees}°.`);
  }
  return best;
}

/** Distance along `link` of its point closest to (x, z). */
export function alongAt(graph: LaneGraph, link: number, x: number, z: number): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let k = graph.pointStart[link]!; k < graph.pointStart[link + 1]!; k++) {
    const distance = Math.hypot(graph.pointX[k]! - x, graph.pointZ[k]! - z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = graph.along[k]!;
    }
  }
  return best;
}

/** Every link's successors, as arrays. */
export function successorsOf(graph: LaneGraph, link: number): number[] {
  return [...graph.successors.subarray(graph.successorStart[link]!, graph.successorStart[link + 1]!)];
}

export function conflictsOf(graph: LaneGraph, link: number): number[] {
  return [...graph.conflicts.subarray(graph.conflictStart[link]!, graph.conflictStart[link + 1]!)];
}

/** Points of `link` as [x, z] pairs. */
export function pointsOf(graph: LaneGraph, link: number): [number, number][] {
  const points: [number, number][] = [];
  for (let k = graph.pointStart[link]!; k < graph.pointStart[link + 1]!; k++) {
    points.push([graph.pointX[k]!, graph.pointZ[k]!]);
  }
  return points;
}
