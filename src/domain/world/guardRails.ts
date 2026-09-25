import type { Point2, RoadKind } from '../../data/definitions/MapDefinition';
import { createRoadPoint, type RoadPath, type RoadPoint } from './RoadPath';

/** Guard rails line the outside of bends tighter than this radius… */
const BEND_RADIUS_METERS = 300;
/** …measured over this far either side of each post, that turn the road at least this far in all… */
const BEND_SPAN_METERS = 12;
const MIN_BEND_TURN_RADIANS = (25 * Math.PI) / 180;
/** …on the roads out of town (city streets have kerbs and lamps instead). */
const RAILED_ROADS: readonly RoadKind[] = ['rural', 'highway', 'ringRoad'];
/** A rail stands this far beyond the asphalt's edge, on posts this far apart. */
export const GUARD_RAIL_OUT_METERS = 1.2;
export const GUARD_RAIL_POST_SPACING_METERS = 2.5;
/** Its posts are set out square to the road's direction over this far either way, smoothing the samples' corners. */
const TANGENT_SPAN_METERS = 2;
/** It runs on this far past its bend either way; a shorter rail than this is left out. */
const RUN_ON_METERS = 15;
const MIN_RAIL_METERS = 30;

/**
 * A guard rail on the outside of a bend: a steel beam on posts. The truck
 * stops at it or glances off it like at any wall (DrivingWorld).
 */
export interface GuardRail {
  /** The posts, in order, GUARD_RAIL_POST_SPACING_METERS apart: the beam runs through them. */
  readonly points: readonly Point2[];
  /**
   * Which side of the rail the road is on, as the rail runs (from its first
   * point on): the beam faces that way, the posts stand behind it.
   */
  readonly roadSide: 'left' | 'right';
}

/**
 * Places the guard rails: on the outside of every bend of the railed roads
 * tighter than BEND_RADIUS_METERS, running on RUN_ON_METERS past it,
 * GUARD_RAIL_OUT_METERS beyond the asphalt. A rail breaks off where
 * `isClear` rejects a post (junctions, yards, other roads…), and pieces
 * shorter than MIN_RAIL_METERS are left out. Deterministic.
 */
export function placeGuardRails(roads: readonly RoadPath[], isClear: (x: number, z: number) => boolean): GuardRail[] {
  const rails: GuardRail[] = [];
  const point = createRoadPoint();
  const before = createRoadPoint();
  const after = createRoadPoint();
  for (const road of roads) {
    if (!RAILED_ROADS.includes(road.kind)) {
      continue;
    }
    // Posts evenly along the road; a ring's last one is its first.
    const count = road.closed
      ? Math.max(1, Math.round(road.lengthMeters / GUARD_RAIL_POST_SPACING_METERS))
      : Math.floor(road.lengthMeters / GUARD_RAIL_POST_SPACING_METERS) + 1;
    const spacing = road.closed ? road.lengthMeters / count : GUARD_RAIL_POST_SPACING_METERS;
    const turns = Array.from({ length: count }, (_, index) => turnAt(road, index * spacing, before, after));
    const bends = sharpBends(turns, spacing, road.closed);
    const sides = runOn(bends, Math.round(RUN_ON_METERS / spacing), road.closed);
    const out = road.widthMeters / 2 + GUARD_RAIL_OUT_METERS;
    const posts = sides.map((side, index): Point2 | null => {
      if (side === 0) {
        return null;
      }
      road.pointAt(index * spacing, point);
      road.pointAt(index * spacing - TANGENT_SPAN_METERS, before);
      road.pointAt(index * spacing + TANGENT_SPAN_METERS, after);
      const length = Math.hypot(after.x - before.x, after.z - before.z) || 1;
      // Left of the direction of travel is (directionZ, -directionX).
      const x = point.x + ((after.z - before.z) / length) * out * side;
      const z = point.z - ((after.x - before.x) / length) * out * side;
      return isClear(x, z) ? [x, z] : null;
    });
    for (const run of runsOf(sides, posts, road.closed)) {
      if ((run.points.length - 1) * spacing >= MIN_RAIL_METERS) {
        // On the left of the road, the road is on the rail's right.
        rails.push({ points: run.points, roadSide: run.side === 1 ? 'right' : 'left' });
      }
    }
  }
  return rails;
}

/**
 * How far the road turns per meter at `along` (radians; positive toward
 * the right of its direction, (-directionZ, directionX)), over
 * BEND_SPAN_METERS either way. `before` and `after` are scratch points.
 */
function turnAt(road: RoadPath, along: number, before: RoadPoint, after: RoadPoint): number {
  road.pointAt(along - BEND_SPAN_METERS, before);
  road.pointAt(along + BEND_SPAN_METERS, after);
  const turn = Math.atan2(
    before.directionX * after.directionZ - before.directionZ * after.directionX,
    before.directionX * after.directionX + before.directionZ * after.directionZ,
  );
  return turn / (2 * BEND_SPAN_METERS);
}

/**
 * At each post, which side of the road is the outside of a sharp bend: 1
 * on the left (the road turns right), -1 on the right (it turns left), 0
 * off the bends. A bend is a stretch tighter than BEND_RADIUS_METERS the
 * same way that turns the road MIN_BEND_TURN_RADIANS in all: a wiggle
 * between two bends is none.
 */
function sharpBends(turns: readonly number[], spacing: number, closed: boolean): (-1 | 0 | 1)[] {
  const count = turns.length;
  const sideOf = (turn: number): -1 | 0 | 1 => (Math.abs(turn) * BEND_RADIUS_METERS < 1 ? 0 : turn > 0 ? 1 : -1);
  const sides = turns.map(sideOf);
  const bends: (-1 | 0 | 1)[] = sides.map(() => 0);
  // Start a ring's walk where it is off the bends, so no bend is split across its start.
  const start = closed ? Math.max(0, sides.indexOf(0)) : 0;
  let from = 0;
  while (from < count) {
    const side = sides[(start + from) % count]!;
    let to = from;
    let turned = 0;
    while (to < count && sides[(start + to) % count] === side) {
      turned += turns[(start + to) % count]! * spacing;
      to++;
    }
    if (side !== 0 && Math.abs(turned) >= MIN_BEND_TURN_RADIANS) {
      for (let at = from; at < to; at++) {
        bends[(start + at) % count] = side;
      }
    }
    from = to;
  }
  return bends;
}

/**
 * The bends' sides spread `reach` posts either way along the road (around a
 * ring on a closed road): each post takes the side of the nearest bend in
 * reach, a bend's own post keeps its own.
 */
function runOn(bends: readonly (-1 | 0 | 1)[], reach: number, closed: boolean): (-1 | 0 | 1)[] {
  const count = bends.length;
  return bends.map((side, index) => {
    if (side !== 0) {
      return side;
    }
    for (let step = 1; step <= reach; step++) {
      for (const at of [index - step, index + step]) {
        const wrapped = closed ? ((at % count) + count) % count : at;
        if (wrapped >= 0 && wrapped < count && bends[wrapped] !== 0) {
          return bends[wrapped]!;
        }
      }
    }
    return 0;
  });
}

/**
 * Unbroken stretches of posts on one side: a missing post or a change of
 * side ends one. On a closed road the stretch across the start is one.
 */
function runsOf(
  sides: readonly (-1 | 0 | 1)[],
  posts: readonly (Point2 | null)[],
  closed: boolean,
): { side: -1 | 1; points: Point2[] }[] {
  const runs: { side: -1 | 1; start: number; points: Point2[] }[] = [];
  let current: { side: -1 | 1; start: number; points: Point2[] } | null = null;
  posts.forEach((post, index) => {
    const side = sides[index]!;
    if (post === null || side === 0) {
      current = null;
      return;
    }
    if (current === null || current.side !== side) {
      current = { side, start: index, points: [] };
      runs.push(current);
    }
    current.points.push(post);
  });
  const first = runs[0];
  const last = runs[runs.length - 1];
  if (closed && first !== undefined && last !== undefined && first !== last && first.start === 0) {
    const lastIndex = last.start + last.points.length - 1;
    if (lastIndex === posts.length - 1 && last.side === first.side) {
      runs.pop();
      first.points.unshift(...last.points);
    }
  }
  return runs.map(({ side, points }) => ({ side, points }));
}
