import { describe, expect, it } from 'vitest';
import { GAME_CONTENT } from '../../../../src/data/content';
import { COMFORTABLE_DECELERATION, LaneGraph, TURN_LATERAL_ACCELERATION } from '../../../../src/domain/traffic/LaneGraph';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import {
  conflictsOf,
  crossingStreets,
  laneAt,
  laneGraphOf,
  pointsOf,
  roadFixture,
  roadWorld,
  straightStreet,
  successorsOf,
  TEST_SPEED_LIMITS,
} from '../../../support/trafficFixtures';

describe('LaneGraph', () => {
  it('lays a lane each way on the right-hand side of a street', () => {
    const graph = laneGraphOf(straightStreet());
    const north = laneAt(graph, 0, 0, 0);
    const south = laneAt(graph, 0, 0, 180);

    // Heading +Z the driver's right is -X; heading -Z it is +X. A 10 m street has 5 m lanes.
    for (const [x] of pointsOf(graph, north)) expect(x).toBeCloseTo(-2.5, 6);
    for (const [x] of pointsOf(graph, south)) expect(x).toBeCloseTo(2.5, 6);
    expect(graph.opposite[north]).toBe(south);
    expect(graph.opposite[south]).toBe(north);
    expect(graph.parallel[north]).toBe(-1);
    expect(graph.speedLimit[north]).toBe(TEST_SPEED_LIMITS.street);
  });

  it('turns traffic round in the turning circle at each dead end, inside the paved circle', () => {
    const world = straightStreet();
    const graph = laneGraphOf(world);
    const north = laneAt(graph, 0, 0, 0);
    const south = laneAt(graph, 0, 0, 180);
    const [uTurn] = successorsOf(graph, north);

    expect(world.turningCircles).toHaveLength(2);
    expect(graph.kindOf(uTurn!)).toBe('uTurn');
    expect(successorsOf(graph, uTurn!)).toEqual([south]);
    // The U-turn starts where the lane ends and ends where the lane back starts.
    const points = pointsOf(graph, uTurn!);
    const northPoints = pointsOf(graph, north);
    expect(points[0]).toEqual(northPoints[northPoints.length - 1]);
    expect(points[points.length - 1]).toEqual(pointsOf(graph, south)[0]);
    // A bus (1.25 m half-width) on the loop keeps its wheels on the pavement: the road or the circle.
    const circle = world.turningCircles.find((candidate) => candidate.z > 0)!;
    for (const [x, z] of points) {
      const onRoad = Math.abs(x) <= 5 - 1.25 && z <= 200;
      const inCircle = Math.hypot(x - circle.x, z - circle.z) <= circle.radiusMeters - 1.25;
      expect(onRoad || inCircle, `(${x.toFixed(1)}, ${z.toFixed(1)})`).toBe(true);
    }
    // It swings wide: well beyond the lanes, and it goes round the far side of the circle.
    expect(Math.max(...points.map(([x]) => Math.abs(x)))).toBeGreaterThan(6);
    expect(Math.max(...points.map(([, z]) => z))).toBeGreaterThan(circle.z + 5);
    // Slow, but not a crawl: the tightest arc is 7 m.
    const slowest = Math.min(...graph.advisorySpeed.subarray(graph.pointStart[uTurn!]!, graph.pointStart[uTurn! + 1]!));
    expect(slowest).toBeGreaterThan(Math.sqrt(TURN_LATERAL_ACCELERATION * 6));
    expect(slowest).toBeLessThan(Math.sqrt(TURN_LATERAL_ACCELERATION * 8));
  });

  it('turns from every lane into a junction to every road out of it, but never back the way it came', () => {
    const graph = laneGraphOf(crossingStreets());
    const fromSouth = laneAt(graph, 0, -50, 0);
    const turns = successorsOf(graph, fromSouth);

    expect(turns).toHaveLength(3); // Straight on, left and right.
    for (const turn of turns) {
      expect(graph.kindOf(turn)).toBe('turn');
      expect(graph.turnFrom[turn]).toBe(fromSouth);
    }
    const destinations = turns.map((turn) => graph.turnTo[turn]!).sort((a, b) => a - b);
    expect(destinations).toEqual(
      [laneAt(graph, 0, 50, 0), laneAt(graph, 50, 0, 90), laneAt(graph, -50, 0, 270)].sort((a, b) => a - b),
    );
    expect(destinations).not.toContain(laneAt(graph, 0, -50, 180));
    // 4 approaches × 3 ways at the crossing, and a U-turn at each of the 4 dead ends.
    const kinds = Array.from({ length: graph.linkCount }, (_, link) => graph.kindOf(link));
    expect(kinds.filter((kind) => kind === 'turn')).toHaveLength(12);
    expect(kinds.filter((kind) => kind === 'uTurn')).toHaveLength(4);
    expect(kinds.filter((kind) => kind === 'lane')).toHaveLength(8);
  });

  it('marks turns that cross or merge as conflicting, and lets turns that do not meet go together', () => {
    const graph = laneGraphOf(crossingStreets());
    const turn = (fromX: number, fromZ: number, heading: number, toX: number, toZ: number, toHeading: number): number => {
      const from = laneAt(graph, fromX, fromZ, heading);
      const to = laneAt(graph, toX, toZ, toHeading);
      const found = successorsOf(graph, from).find((candidate) => graph.turnTo[candidate] === to);
      if (found === undefined) throw new Error('no such turn');
      return found;
    };
    const southStraight = turn(0, -50, 0, 0, 50, 0);
    const northStraight = turn(0, 50, 180, 0, -50, 180);
    // Heading +Z, right is -X: from the south, a right turn heads for -X.
    const southRight = turn(0, -50, 0, -50, 0, 270);
    const southLeft = turn(0, -50, 0, 50, 0, 90);
    const northRight = turn(0, 50, 180, 50, 0, 90);
    const westStraight = turn(-50, 0, 90, 50, 0, 90);
    const eastStraight = turn(50, 0, 270, -50, 0, 270);

    // Straight on from opposite sides, and right turns from opposite sides: no conflict.
    expect(conflictsOf(graph, southStraight)).not.toContain(northStraight);
    expect(conflictsOf(graph, southRight)).not.toContain(northRight);
    // Crossing traffic, a left turn across oncoming traffic, merging into one lane: conflicts, both ways.
    expect(conflictsOf(graph, southStraight)).toContain(westStraight);
    expect(conflictsOf(graph, westStraight)).toContain(southStraight);
    expect(conflictsOf(graph, southLeft)).toContain(northStraight);
    expect(conflictsOf(graph, southLeft)).toContain(westStraight); // Both end in the lane heading +X.
    expect(conflictsOf(graph, northRight)).toContain(westStraight);
    // Turns off the same lane follow each other instead.
    expect(conflictsOf(graph, southStraight)).not.toContain(southLeft);
    expect(conflictsOf(graph, eastStraight)).not.toContain(westStraight);
  });

  it('keeps traffic in the right lane of a highway and joins it there, with the overtaking lane beside it', () => {
    const graph = laneGraphOf(
      roadWorld([
        roadFixture('side_road', 'street', 10, [
          [0, -600],
          [0, -500],
          [0, -400],
        ]),
        roadFixture('motorway', 'highway', 14, [
          [0, -400],
          [0, 0],
          [0, 400],
        ]),
      ]),
    );
    const right = laneAt(graph, 0, 0, 0, 0);
    const overtaking = laneAt(graph, 0, 0, 0, 1);

    for (const [x] of pointsOf(graph, right)) expect(x).toBeCloseTo(-5.25, 6); // 14 m: 3.5 m lanes.
    for (const [x] of pointsOf(graph, overtaking)) expect(x).toBeCloseTo(-1.75, 6);
    expect(graph.parallel[right]).toBe(overtaking);
    expect(graph.parallel[overtaking]).toBe(right);
    expect(graph.opposite[right]).toBe(-1); // Two lanes each way: overtake, never go round through oncoming traffic.
    // From the side road traffic joins the right lane only; both lanes lead off the highway.
    const joining = successorsOf(graph, laneAt(graph, 0, -500, 0));
    expect(joining.map((turn) => graph.turnTo[turn])).toEqual([right]);
    const leaving = laneAt(graph, 0, -200, 180, 1);
    expect(successorsOf(graph, leaving).map((turn) => graph.turnTo[turn])).toEqual([laneAt(graph, 0, -500, 180)]);
  });

  it('maps a place in one lane to the same place in the lane beside it and the lane the other way', () => {
    const graph = laneGraphOf(
      roadWorld([
        roadFixture('bendy', 'highway', 14, [
          [0, -400],
          [0, 0],
          [300, 300],
          [700, 300],
        ]),
      ]),
    );
    const right = laneAt(graph, 0, -100, 0, 0);
    const overtaking = graph.parallel[right]!;
    const s = 250;
    const mapped = graph.mapAcross(right, s, overtaking);

    // The same distance along the centreline, in a lane of a different length round the bend.
    expect(graph.centreAt(overtaking, mapped)).toBeCloseTo(graph.centreAt(right, s), 6);
    const street = laneGraphOf(straightStreet());
    const north = laneAt(street, 0, 0, 0);
    const south = street.opposite[north]!;
    const along = street.mapAcross(north, 100, south);
    expect(street.centreAt(north, 100) + street.centreAt(south, along)).toBeCloseTo(street.stretchLength[north]!, 6);
  });

  it('advises slowing for a tight turn in time, braking no harder than is comfortable', () => {
    const graph = laneGraphOf(crossingStreets());
    const fromSouth = laneAt(graph, 0, -50, 0);
    const first = graph.pointStart[fromSouth]!;
    const last = graph.pointStart[fromSouth + 1]! - 1;

    // A straight lane: nothing to slow for on it.
    expect(graph.advisorySpeed[first]).toBe(Infinity);
    // A right turn round the corner is slower than straight on.
    const turns = successorsOf(graph, fromSouth);
    const slowest = (link: number): number =>
      Math.min(...graph.advisorySpeed.subarray(graph.pointStart[link]!, graph.pointStart[link + 1]!));
    const byTightness = [...turns].sort((a, b) => slowest(a) - slowest(b));
    expect(slowest(byTightness[0]!)).toBeLessThan(6);
    expect(slowest(byTightness[2]!)).toBe(Infinity); // Straight on.
    // Along a turn the advice never asks for more than comfortable braking between points.
    const turn = byTightness[0]!;
    for (let k = graph.pointStart[turn]!; k < graph.pointStart[turn + 1]! - 1; k++) {
      const gap = graph.along[k + 1]! - graph.along[k]!;
      const next = graph.advisorySpeed[k + 1]!;
      expect(graph.advisorySpeed[k]! ** 2).toBeLessThanOrEqual(next ** 2 + 2 * COMFORTABLE_DECELERATION * gap + 1e-9);
    }
    expect(last).toBeGreaterThan(first);
  });

  it('finds the segment that holds a distance along a link', () => {
    const graph = laneGraphOf(straightStreet());
    const north = laneAt(graph, 0, 0, 0);
    const first = graph.pointStart[north]!;

    for (const s of [0, 3.9, 4, 100.5, graph.length[north]!]) {
      const segment = graph.segmentAt(north, s);
      expect(graph.along[first + segment]!).toBeLessThanOrEqual(s);
      expect(segment).toBeLessThanOrEqual(graph.pointStart[north + 1]! - first - 2);
      if (s < graph.length[north]!) {
        expect(graph.along[first + segment + 1]!).toBeGreaterThan(s);
      }
    }
  });

  it('lets traffic go round a closed road without junctions forever', () => {
    const graph = laneGraphOf(
      roadWorld([
        roadFixture(
          'loop',
          'ringRoad',
          11,
          [
            [0, -200],
            [200, 0],
            [0, 200],
            [-200, 0],
          ],
          true,
        ),
      ]),
    );
    const lanes = Array.from({ length: graph.linkCount }, (_, link) => link);

    expect(lanes).toHaveLength(2);
    for (const lane of lanes) {
      expect(successorsOf(graph, lane)).toEqual([lane]);
      const points = pointsOf(graph, lane);
      expect(points[0]![0]).toBeCloseTo(points[points.length - 1]![0], 6);
      expect(points[0]![1]).toBeCloseTo(points[points.length - 1]![1], 6);
    }
  });

  describe('on the region map', () => {
    const world = new DrivingWorld(GAME_CONTENT.maps[0]!);
    const graph = new LaneGraph(world, TEST_SPEED_LIMITS);

    it('connects every link to every other, so traffic can reach every road and never gets stuck', () => {
      // Where a vehicle can go from a link: on along it, or into the lane beside it (overtaking).
      const onwards = (link: number): number[] =>
        graph.parallel[link]! >= 0 ? [...successorsOf(graph, link), graph.parallel[link]!] : successorsOf(graph, link);
      const reachableFrom = (start: number, forward: boolean): Set<number> => {
        const seen = new Set([start]);
        const stack = [start];
        while (stack.length > 0) {
          const link = stack.pop()!;
          const nextLinks = forward
            ? onwards(link)
            : Array.from({ length: graph.linkCount }, (_, other) => other).filter((other) => onwards(other).includes(link));
          for (const next of nextLinks) {
            if (!seen.has(next)) {
              seen.add(next);
              stack.push(next);
            }
          }
        }
        return seen;
      };

      expect(reachableFrom(0, true).size).toBe(graph.linkCount);
      expect(reachableFrom(0, false).size).toBe(graph.linkCount);
    });

    it('has a turning circle at both dead ends of the starting town', () => {
      expect(world.turningCircles.map((circle) => world.roads[circle.roadIndex]!.id).sort()).toEqual([
        'a_harbour_road',
        'a_high_street',
      ]);
    });

    it('keeps lanes and turns joined without gaps', () => {
      for (let link = 0; link < graph.linkCount; link++) {
        const points = pointsOf(graph, link);
        const end = points[points.length - 1]!;
        for (const next of successorsOf(graph, link)) {
          const start = pointsOf(graph, next)[0]!;
          expect(Math.hypot(start[0] - end[0], start[1] - end[1]), `${link} → ${next}`).toBeLessThan(1e-6);
        }
      }
    });
  });
});
