import type { RoadKind } from '../../data/definitions/MapDefinition';
import type { DrivingWorld } from '../world/DrivingWorld';
import { laneOffsetMeters, lanesPerDirection } from '../world/lanes';
import type { RoadPath } from '../world/RoadPath';

/**
 * What a link is: a lane along a stretch of road, a turn across a junction
 * (going straight on counts as a turn), or a U-turn round a turning circle.
 */
export const LINK_KINDS = ['lane', 'turn', 'uTurn'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
const LANE = 0;
const TURN = 1;
const U_TURN = 2;

/** Sideways acceleration traffic keeps to in bends and turns, m/s². */
export const TURN_LATERAL_ACCELERATION = 2.2;
/** Braking traffic plans with when it slows for a bend or a turn ahead, m/s². */
export const COMFORTABLE_DECELERATION = 2.5;
/** Lanes stop this far past the widest road's edge short of a junction; turns fill the gap. */
const JUNCTION_APPROACH_METERS = 5;
/**
 * At a dead end traffic swings right, loops left round the turning circle
 * (this radius) and swings right again into the lane back: the light-bulb
 * shape of a cul-de-sac U-turn.
 */
export const U_TURN_LOOP_RADIUS_METERS = 7;
const U_TURN_SWING_RADIUS_METERS = 7;
/**
 * Turns whose paths come closer than this conflict: two buses on them would
 * touch (2.5 m wide, and their ends swing wide of a tight path). Straight on
 * from opposite sides stays clear: those lanes are 5 m apart.
 */
const CONFLICT_DISTANCE_METERS = 4.5;
/** Points along turns, meters apart. */
const TURN_POINT_SPACING_METERS = 1;
/** Turns that keep to the same road are more likely than turns off it… */
const SAME_ROAD_WEIGHT = 1.6;
/** …and turns into a dead-end street are rare. */
const DEAD_END_WEIGHT = 0.3;

interface NodeBuild {
  readonly x: number;
  readonly z: number;
  /** Traffic keeps this far out of the node until it may turn (a junction's box, a turning circle). */
  readonly radius: number;
  /** Lanes end this far short of a junction (dead ends: see uTurnClearance). */
  readonly clearance: number;
  readonly deadEnd: DeadEndFrame | null;
}

/** Where a dead-end road ends, which way it points out of its end, and how far past it the turning circle's centre is. */
interface DeadEndFrame {
  readonly endX: number;
  readonly endZ: number;
  readonly dirX: number;
  readonly dirZ: number;
  readonly centreAhead: number;
}

interface LinkBuild {
  readonly kind: number;
  readonly points: number[];
  /** Lanes: distance along the stretch's centreline at each point, from where the lane's direction starts. */
  readonly centre: number[];
  readonly speedLimit: number;
  readonly road: number;
  readonly laneIndex: number;
  readonly startNode: number;
  readonly endNode: number;
  readonly stretch: number;
  readonly direction: number;
  readonly stretchLength: number;
  readonly laneOffset: number;
  /** Turns: the lanes they join, and how likely traffic takes them. */
  readonly from: number;
  readonly to: number;
  readonly weight: number;
}

/**
 * The lanes of a map for traffic (roadmap step 22, spec §19: waypoint-based
 * traffic). Every link is a polyline of waypoints that vehicles follow:
 *
 * - lanes along each stretch of road between junctions, on the right-hand
 *   side, two each way on the highway;
 * - turns across every junction, from each lane in to the rightmost lane of
 *   every road out (not back the way it came);
 * - U-turns round the turning circle at each dead end.
 *
 * Turns that cross or merge conflict: one vehicle at a time takes a turn of
 * a set of conflicting turns (see TrafficSimulation). Every point carries an
 * advisory speed, so traffic slows for bends and turns ahead in time.
 *
 * Arrays are indexed by link, or by point (all links' points in one run;
 * link `l` owns points pointStart[l] .. pointStart[l + 1] - 1).
 */
export class LaneGraph {
  readonly linkCount: number;
  readonly kind: Uint8Array;
  readonly pointStart: Int32Array;
  readonly pointX: Float64Array;
  readonly pointZ: Float64Array;
  /** Distance from the link's first point, meters. */
  readonly along: Float64Array;
  /** Fastest a vehicle should be going at each point to take the bends and turns ahead, m/s. */
  readonly advisorySpeed: Float64Array;
  /** Lanes: distance along the stretch's centreline (see LinkBuild.centre); turns: `along`. */
  readonly centre: Float64Array;
  readonly length: Float64Array;
  /** Speed limit of the road, m/s (turns: the lower of the two roads). */
  readonly speedLimit: Float64Array;
  /** Where a link may lead: successors[successorStart[l]] .. successors[successorStart[l + 1] - 1]. */
  readonly successorStart: Int32Array;
  readonly successors: Int32Array;
  readonly successorWeights: Float64Array;
  /** Turns: the lane they start from and the lane they end in; -1 for lanes. */
  readonly turnFrom: Int32Array;
  readonly turnTo: Int32Array;
  /** Turns: their junction or turning circle (a node); lanes: the node they end at, or -1. */
  readonly node: Int32Array;
  /** Turns that conflict with turn `l`: conflicts[conflictStart[l]] .. conflicts[conflictStart[l + 1] - 1]. */
  readonly conflictStart: Int32Array;
  readonly conflicts: Int32Array;
  /** Lanes: the lane beside it in the same direction (for overtaking), or -1. */
  readonly parallel: Int32Array;
  /** Lanes of two-lane roads: the lane the other way (for going round an obstacle), or -1. */
  readonly opposite: Int32Array;
  /** Lanes: 0 for the rightmost lane, 1 for the one left of it. */
  readonly laneIndex: Int8Array;
  /** Lanes: how far right of the centreline the lane runs; its width is what traffic keeps inside. */
  readonly laneOffset: Float64Array;
  readonly laneWidth: Float64Array;
  /** Lanes: the length of their stretch's centreline (maps positions to the lane the other way). */
  readonly stretchLength: Float64Array;
  /** Junctions and turning circles. */
  readonly nodeCount: number;
  readonly nodeX: Float64Array;
  readonly nodeZ: Float64Array;
  readonly nodeRadius: Float64Array;
  /** Lanes where traffic may appear: every rightmost lane, by index. */
  readonly spawnLanes: Int32Array;

  constructor(world: DrivingWorld, speedLimitsMetersPerSecond: Readonly<Record<RoadKind, number>>) {
    const nodes = buildNodes(world);
    const links: LinkBuild[] = [];
    const laneIds = buildLanes(world, nodes, speedLimitsMetersPerSecond, links);
    buildTurns(nodes, laneIds, links);

    const count = links.length;
    this.linkCount = count;
    this.kind = Uint8Array.from(links, (link) => link.kind);
    this.pointStart = new Int32Array(count + 1);
    let points = 0;
    links.forEach((link, index) => {
      this.pointStart[index] = points;
      points += link.points.length / 2;
    });
    this.pointStart[count] = points;
    this.pointX = new Float64Array(points);
    this.pointZ = new Float64Array(points);
    this.along = new Float64Array(points);
    this.centre = new Float64Array(points);
    this.advisorySpeed = new Float64Array(points);
    this.length = new Float64Array(count);
    links.forEach((link, index) => {
      const first = this.pointStart[index]!;
      let distance = 0;
      for (let k = 0; k < link.points.length / 2; k++) {
        const x = link.points[k * 2]!;
        const z = link.points[k * 2 + 1]!;
        if (k > 0) {
          distance += Math.hypot(x - this.pointX[first + k - 1]!, z - this.pointZ[first + k - 1]!);
        }
        this.pointX[first + k] = x;
        this.pointZ[first + k] = z;
        this.along[first + k] = distance;
        this.centre[first + k] = link.kind === LANE ? link.centre[k]! : distance;
      }
      this.length[index] = distance;
    });
    this.speedLimit = Float64Array.from(links, (link) => link.speedLimit);
    this.turnFrom = Int32Array.from(links, (link) => link.from);
    this.turnTo = Int32Array.from(links, (link) => link.to);
    this.node = Int32Array.from(links, (link) => (link.kind === LANE ? link.endNode : link.startNode));
    this.laneIndex = Int8Array.from(links, (link) => link.laneIndex);
    this.laneOffset = Float64Array.from(links, (link) => link.laneOffset);
    this.laneWidth = Float64Array.from(links, (link) =>
      link.kind === LANE ? laneWidthOf(world.roads[link.road]!) : 3.5,
    );
    this.stretchLength = Float64Array.from(links, (link) => link.stretchLength);

    // Successors: a lane leads to its turns (or round a closed road without junctions, to itself); a turn to its lane.
    const successors: number[][] = links.map(() => []);
    const weights: number[][] = links.map(() => []);
    links.forEach((link, index) => {
      if (link.kind !== LANE) {
        successors[link.from]!.push(index);
        weights[link.from]!.push(link.weight);
        successors[index]!.push(link.to);
        weights[index]!.push(1);
      } else if (link.startNode < 0 && link.endNode < 0) {
        successors[index]!.push(index);
        weights[index]!.push(1);
      }
    });
    [this.successorStart, this.successors] = flatten(successors);
    this.successorWeights = Float64Array.from(weights.flat());

    // Conflicts between turns at the same node.
    const conflicts: number[][] = links.map(() => []);
    links.forEach((a, i) => {
      if (a.kind === LANE) {
        return;
      }
      links.forEach((b, j) => {
        if (j !== i && b.kind !== LANE && b.startNode === a.startNode && turnsConflict(a, b)) {
          conflicts[i]!.push(j);
        }
      });
    });
    [this.conflictStart, this.conflicts] = flatten(conflicts);

    this.parallel = new Int32Array(count).fill(-1);
    this.opposite = new Int32Array(count).fill(-1);
    links.forEach((a, i) => {
      if (a.kind !== LANE) {
        return;
      }
      links.forEach((b, j) => {
        if (j === i || b.kind !== LANE || b.stretch !== a.stretch) {
          return;
        }
        if (b.direction === a.direction) {
          this.parallel[i] = j;
        } else if (lanesPerDirection(world.roads[a.road]!.kind) === 1) {
          this.opposite[i] = j;
        }
      });
    });

    this.nodeCount = nodes.length;
    this.nodeX = Float64Array.from(nodes, (node) => node.x);
    this.nodeZ = Float64Array.from(nodes, (node) => node.z);
    this.nodeRadius = Float64Array.from(nodes, (node) => node.radius);
    this.spawnLanes = Int32Array.from(
      links.flatMap((link, index) => (link.kind === LANE && link.laneIndex === 0 ? [index] : [])),
    );
    this.computeAdvisorySpeeds();
  }

  kindOf(link: number): LinkKind {
    return LINK_KINDS[this.kind[link]!]!;
  }

  /** True for turns across a junction and U-turns. */
  isTurn(link: number): boolean {
    return this.kind[link] !== LANE;
  }

  /** Index of the segment (points i, i + 1 of the link, counted from its first point) that holds distance `s`. */
  segmentAt(link: number, s: number): number {
    const first = this.pointStart[link]!;
    let low = 0;
    let high = this.pointStart[link + 1]! - first - 2;
    if (high <= 0) {
      return 0;
    }
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (this.along[first + middle]! <= s) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low;
  }

  /**
   * The distance along lane `to` level with distance `s` along lane `from`:
   * the same place on the road, in the lane beside it (same direction) or the
   * one the other way.
   */
  mapAcross(from: number, s: number, to: number): number {
    const centre = this.centreAt(from, s);
    const target = this.parallel[from] === to ? centre : this.stretchLength[from]! - centre;
    return this.alongAtCentre(to, target);
  }

  /** Distance along the stretch's centreline at distance `s` along lane `link`. */
  centreAt(link: number, s: number): number {
    const first = this.pointStart[link]!;
    const segment = this.segmentAt(link, s);
    const a = first + segment;
    const span = this.along[a + 1]! - this.along[a]!;
    const t = span > 0 ? Math.min(1, Math.max(0, (s - this.along[a]!) / span)) : 0;
    return this.centre[a]! + (this.centre[a + 1]! - this.centre[a]!) * t;
  }

  private alongAtCentre(link: number, centre: number): number {
    const first = this.pointStart[link]!;
    const last = this.pointStart[link + 1]! - 1;
    if (centre <= this.centre[first]!) {
      return 0;
    }
    if (centre >= this.centre[last]!) {
      return this.length[link]!;
    }
    let low = first;
    let high = last - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (this.centre[middle]! <= centre) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    const span = this.centre[low + 1]! - this.centre[low]!;
    const t = span > 0 ? (centre - this.centre[low]!) / span : 0;
    return this.along[low]! + (this.along[low + 1]! - this.along[low]!) * t;
  }

  /**
   * Advisory speed at every point: no faster than the bend there allows, and
   * slow enough to brake comfortably for the bends further along the link.
   */
  private computeAdvisorySpeeds(): void {
    for (let link = 0; link < this.linkCount; link++) {
      const first = this.pointStart[link]!;
      const last = this.pointStart[link + 1]! - 1;
      for (let i = last; i >= first; i--) {
        let speed = Infinity;
        if (i > first && i < last) {
          const ax = this.pointX[i]! - this.pointX[i - 1]!;
          const az = this.pointZ[i]! - this.pointZ[i - 1]!;
          const bx = this.pointX[i + 1]! - this.pointX[i]!;
          const bz = this.pointZ[i + 1]! - this.pointZ[i]!;
          const turn = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
          if (turn > 1e-4) {
            const radius = (Math.hypot(ax, az) + Math.hypot(bx, bz)) / 2 / turn;
            speed = Math.sqrt(TURN_LATERAL_ACCELERATION * radius);
          }
        }
        if (i < last) {
          const next = this.advisorySpeed[i + 1]!;
          const gap = this.along[i + 1]! - this.along[i]!;
          speed = Math.min(speed, Math.sqrt(next * next + 2 * COMFORTABLE_DECELERATION * gap));
        }
        this.advisorySpeed[i] = speed;
      }
    }
  }
}

function laneWidthOf(road: RoadPath): number {
  return road.widthMeters / 2 / lanesPerDirection(road.kind);
}

/** Junctions and turning circles, with how far short of each the lanes stop. */
function buildNodes(world: DrivingWorld): NodeBuild[] {
  const junctions = world.network.junctions.map((junction): NodeBuild => {
    const widest = Math.max(...junction.members.map((member) => world.roads[member.roadIndex]!.widthMeters));
    const clearance = widest / 2 + JUNCTION_APPROACH_METERS;
    return { x: junction.x, z: junction.z, radius: clearance, clearance, deadEnd: null };
  });
  const circles = world.turningCircles.map((circle): NodeBuild => {
    const road = world.roads[circle.roadIndex]!;
    const endX = road.x(circle.sampleIndex);
    const endZ = road.z(circle.sampleIndex);
    const dx = circle.x - endX;
    const dz = circle.z - endZ;
    const centreAhead = Math.hypot(dx, dz);
    const dirX = centreAhead > 0 ? dx / centreAhead : 0;
    const dirZ = centreAhead > 0 ? dz / centreAhead : 1;
    return {
      x: circle.x,
      z: circle.z,
      radius: circle.radiusMeters,
      clearance: 0,
      deadEnd: { endX, endZ, dirX, dirZ, centreAhead },
    };
  });
  return [...junctions, ...circles];
}

/** Which node each sample of each road belongs to, if any. */
function nodesBySample(world: DrivingWorld): Map<number, number>[] {
  const bySample = world.roads.map(() => new Map<number, number>());
  world.network.junctions.forEach((junction, node) => {
    for (const member of junction.members) {
      bySample[member.roadIndex]!.set(member.sampleIndex, node);
    }
  });
  world.turningCircles.forEach((circle, index) => {
    bySample[circle.roadIndex]!.set(circle.sampleIndex, world.network.junctions.length + index);
  });
  return bySample;
}

/** How far short of a dead end a lane `offset` meters right of the centreline starts its U-turn. */
function uTurnClearance(node: NodeBuild, offset: number): number {
  const loop = U_TURN_LOOP_RADIUS_METERS + U_TURN_SWING_RADIUS_METERS;
  const side = Math.min(offset, U_TURN_LOOP_RADIUS_METERS - 0.5) + U_TURN_SWING_RADIUS_METERS;
  return Math.sqrt(loop * loop - side * side) - (node.deadEnd?.centreAhead ?? 0);
}

/**
 * Cuts every road into stretches at its junctions and dead ends, and lays
 * lanes along each: `links` gets the lanes; the result lists the lane ids.
 */
function buildLanes(
  world: DrivingWorld,
  nodes: readonly NodeBuild[],
  speedLimits: Readonly<Record<RoadKind, number>>,
  links: LinkBuild[],
): number[] {
  const bySample = nodesBySample(world);
  const laneIds: number[] = [];
  let stretchId = 0;
  world.roads.forEach((road, roadIndex) => {
    const count = road.pointCount;
    const cuts = [...bySample[roadIndex]!.keys()].sort((a, b) => a - b);
    const stretches: [number, number][] = [];
    if (road.closed) {
      if (cuts.length === 0) {
        stretches.push([0, count]);
      } else {
        for (let i = 0; i + 1 < cuts.length; i++) {
          stretches.push([cuts[i]!, cuts[i + 1]!]);
        }
        stretches.push([cuts[cuts.length - 1]!, cuts[0]! + count]);
      }
    } else {
      for (let i = 0; i + 1 < cuts.length; i++) {
        stretches.push([cuts[i]!, cuts[i + 1]!]);
      }
    }
    const nodeAt = (sample: number): number => bySample[roadIndex]!.get(sample % count) ?? -1;
    for (const [from, to] of stretches) {
      const startNode = road.closed && cuts.length === 0 ? -1 : nodeAt(from);
      const endNode = road.closed && cuts.length === 0 ? -1 : nodeAt(to);
      const stretchLength = sampleDistance(road, to) - sampleDistance(road, from);
      for (const direction of [1, -1]) {
        for (let laneIndex = 0; laneIndex < lanesPerDirection(road.kind); laneIndex++) {
          const offset = laneOffsetMeters(road.kind, road.widthMeters, laneIndex);
          const clearanceAt = (node: number): number =>
            node < 0 ? 0 : nodes[node]!.deadEnd === null ? nodes[node]!.clearance : uTurnClearance(nodes[node]!, offset);
          let low = clearanceAt(startNode);
          let high = clearanceAt(endNode);
          // A stretch too short for both approaches keeps at least a couple of meters of lane.
          const room = stretchLength - 2;
          if (low + high > room) {
            const scale = Math.max(0, room) / (low + high);
            low *= scale;
            high *= scale;
          }
          const lane = lanePoints(road, from, to, low, stretchLength - high, direction, offset);
          laneIds.push(links.length);
          links.push({
            kind: LANE,
            points: lane.points,
            centre: lane.centre,
            speedLimit: speedLimits[road.kind],
            road: roadIndex,
            laneIndex,
            startNode: direction === 1 ? startNode : endNode,
            endNode: direction === 1 ? endNode : startNode,
            stretch: stretchId,
            direction,
            stretchLength,
            laneOffset: offset,
            from: -1,
            to: -1,
            weight: 1,
          });
        }
      }
      stretchId++;
    }
  });
  return laneIds;
}

/** Distance along the road to sample `k`, which may count past the end of a closed road. */
function sampleDistance(road: RoadPath, k: number): number {
  const count = road.pointCount;
  return (road.distances[k % count] ?? 0) + Math.floor(k / count) * road.lengthMeters;
}

/**
 * A lane between centreline distances `low` and `high` of the stretch from
 * sample `from` to `to`, `offset` meters right of the direction of travel.
 */
function lanePoints(
  road: RoadPath,
  from: number,
  to: number,
  low: number,
  high: number,
  direction: number,
  offset: number,
): { points: number[]; centre: number[] } {
  const start = sampleDistance(road, from);
  const stations: number[] = [start + low];
  for (let k = from + 1; k < to; k++) {
    const distance = sampleDistance(road, k);
    if (distance > start + low + 0.5 && distance < start + high - 0.5) {
      stations.push(distance);
    }
  }
  stations.push(start + high);
  if (direction < 0) {
    stations.reverse();
  }
  const points: number[] = [];
  const centre: number[] = [];
  let k = from;
  for (const distance of stations) {
    // Walk to the sample pair around this distance (forwards or backwards).
    while (k + 1 < to && sampleDistance(road, k + 1) < distance) k++;
    while (k > from && sampleDistance(road, k) > distance) k--;
    const d0 = sampleDistance(road, k);
    const d1 = sampleDistance(road, k + 1);
    const t = d1 > d0 ? Math.min(1, Math.max(0, (distance - d0) / (d1 - d0))) : 0;
    const [x0, z0, r0x, r0z] = sampleFrame(road, k);
    const [x1, z1, r1x, r1z] = sampleFrame(road, k + 1);
    let rx = r0x + (r1x - r0x) * t;
    let rz = r0z + (r1z - r0z) * t;
    const length = Math.hypot(rx, rz) || 1;
    rx /= length;
    rz /= length;
    points.push(x0 + (x1 - x0) * t + rx * offset * direction, z0 + (z1 - z0) * t + rz * offset * direction);
    centre.push(direction > 0 ? distance - start : sampleDistance(road, to) - distance);
  }
  return { points, centre };
}

/** Position of sample `k` and the unit vector to the right of the road's direction there (as TrackView draws it). */
function sampleFrame(road: RoadPath, k: number): [number, number, number, number] {
  const count = road.pointCount;
  const i = k % count;
  const previous = road.closed ? (i - 1 + count) % count : Math.max(0, i - 1);
  const next = road.closed ? (i + 1) % count : Math.min(count - 1, i + 1);
  const tx = road.x(next) - road.x(previous);
  const tz = road.z(next) - road.z(previous);
  const length = Math.hypot(tx, tz) || 1;
  return [road.x(i), road.z(i), -tz / length, tx / length];
}

/** Turns across every junction and U-turns at every dead end. */
function buildTurns(nodes: readonly NodeBuild[], laneIds: readonly number[], links: LinkBuild[]): void {
  const lanes = laneIds.map((id) => ({ id, link: links[id]! }));
  nodes.forEach((node, nodeIndex) => {
    const incoming = lanes.filter(({ link }) => link.endNode === nodeIndex);
    const outgoing = lanes.filter(({ link }) => link.startNode === nodeIndex && link.laneIndex === 0);
    for (const into of incoming) {
      for (const out of outgoing) {
        const reverse = out.link.stretch === into.link.stretch && out.link.direction !== into.link.direction;
        if (node.deadEnd !== null ? !reverse : reverse) {
          continue; // U-turns only at dead ends, and nothing else there.
        }
        const points = node.deadEnd !== null ? uTurnPoints(node, into.link, out.link) : turnPoints(into.link, out.link);
        const leadsToDeadEnd = out.link.endNode >= 0 && nodes[out.link.endNode]!.deadEnd !== null;
        links.push({
          kind: node.deadEnd !== null ? U_TURN : TURN,
          points,
          centre: [],
          speedLimit: Math.min(into.link.speedLimit, out.link.speedLimit),
          road: -1,
          laneIndex: -1,
          startNode: nodeIndex,
          endNode: nodeIndex,
          stretch: -1,
          direction: 0,
          stretchLength: 0,
          laneOffset: 0,
          from: into.id,
          to: out.id,
          weight: (into.link.road === out.link.road ? SAME_ROAD_WEIGHT : 1) * (leadsToDeadEnd ? DEAD_END_WEIGHT : 1),
        });
      }
    }
  });
}

/** A smooth turn from the end of lane `into` to the start of lane `out` (a cubic Bézier through the junction). */
function turnPoints(into: LinkBuild, out: LinkBuild): number[] {
  const n = into.points.length;
  const x0 = into.points[n - 2]!;
  const z0 = into.points[n - 1]!;
  const [t0x, t0z] = unit(x0 - into.points[n - 4]!, z0 - into.points[n - 3]!);
  const x3 = out.points[0]!;
  const z3 = out.points[1]!;
  const [t3x, t3z] = unit(out.points[2]! - x3, out.points[3]! - z3);
  const handle = Math.hypot(x3 - x0, z3 - z0) * 0.4;
  const x1 = x0 + t0x * handle;
  const z1 = z0 + t0z * handle;
  const x2 = x3 - t3x * handle;
  const z2 = z3 - t3z * handle;
  const steps = Math.max(4, Math.ceil((Math.hypot(x3 - x0, z3 - z0) * 1.3) / TURN_POINT_SPACING_METERS));
  const points: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    points.push(a * x0 + b * x1 + c * x2 + d * x3, a * z0 + b * z1 + c * z2 + d * z3);
  }
  return points;
}

/**
 * The U-turn at a dead end, from lane `into` (towards the dead end) to lane
 * `out` (away from it): a right swing onto the loop circle round the
 * turning circle's centre, most of the way round it to the left, and a right
 * swing into the lane back. Built in the dead end's frame: `a` along the
 * road towards its end (0 at the last sample), `l` to the right of it.
 */
function uTurnPoints(node: NodeBuild, into: LinkBuild, out: LinkBuild): number[] {
  const end = node.deadEnd!;
  const loop = U_TURN_LOOP_RADIUS_METERS;
  const swing = U_TURN_SWING_RADIUS_METERS;
  const centre = end.centreAhead;
  const local: number[] = [];
  const entry = swingArc(centre, Math.min(into.laneOffset, loop - 0.5), loop, swing);
  const exit = swingArc(centre, Math.min(out.laneOffset, loop - 0.5), loop, swing);
  local.push(...entry.points);
  // Round the loop circle, clockwise in (a, l) terms (a left turn for the driver), from entry to exit.
  const from = entry.loopAngle;
  const to = -exit.loopAngle;
  const steps = Math.max(8, Math.ceil(((from - to) * loop) / TURN_POINT_SPACING_METERS));
  for (let i = 1; i < steps; i++) {
    const angle = from + ((to - from) * i) / steps;
    local.push(centre + Math.cos(angle) * loop, Math.sin(angle) * loop);
  }
  // The exit swing is the entry swing for the lane back, mirrored and driven backwards.
  for (let i = exit.points.length - 2; i >= 0; i -= 2) {
    local.push(exit.points[i]!, -exit.points[i + 1]!);
  }
  // To world coordinates: a along the road's direction out of the dead end, l to its right.
  const rightX = -end.dirZ;
  const rightZ = end.dirX;
  const points: number[] = [];
  for (let i = 0; i < local.length; i += 2) {
    const a = local[i]!;
    const l = local[i + 1]!;
    points.push(end.endX + end.dirX * a + rightX * l, end.endZ + end.dirZ * a + rightZ * l);
  }
  // Start and end exactly where the lanes do.
  points[0] = into.points[into.points.length - 2]!;
  points[1] = into.points[into.points.length - 1]!;
  points[points.length - 2] = out.points[0]!;
  points[points.length - 1] = out.points[1]!;
  return points;
}

/**
 * The swing from a lane `offset` meters right of the centreline onto the
 * loop circle (radius `loop`, centred `centre` meters past the road's end):
 * an arc of radius `swing` turning right, tangent to both. Returns its
 * points in the dead end's frame and where it meets the loop circle (the
 * angle round the circle's centre).
 */
function swingArc(centre: number, offset: number, loop: number, swing: number): { points: number[]; loopAngle: number } {
  const reach = Math.sqrt((loop + swing) ** 2 - (offset + swing) ** 2);
  const startA = centre - reach;
  const sweep = Math.atan2(reach, offset + swing);
  const steps = Math.max(3, Math.ceil((sweep * swing) / TURN_POINT_SPACING_METERS));
  const points: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (sweep * i) / steps;
    points.push(startA + swing * Math.sin(angle), offset + swing - swing * Math.cos(angle));
  }
  return { points, loopAngle: Math.atan2(offset + swing, -reach) };
}

function unit(x: number, z: number): [number, number] {
  const length = Math.hypot(x, z) || 1;
  return [x / length, z / length];
}

/**
 * Two turns at one node conflict when they end in the same lane (they
 * merge) or their paths cross. Turns from the same lane never do: their
 * vehicles follow each other until they part.
 */
function turnsConflict(a: LinkBuild, b: LinkBuild): boolean {
  if (a.from === b.from) {
    return false;
  }
  if (a.to === b.to) {
    return true;
  }
  const limit = CONFLICT_DISTANCE_METERS * CONFLICT_DISTANCE_METERS;
  for (let i = 0; i < a.points.length; i += 2) {
    for (let j = 0; j < b.points.length; j += 2) {
      const dx = a.points[i]! - b.points[j]!;
      const dz = a.points[i + 1]! - b.points[j + 1]!;
      if (dx * dx + dz * dz < limit) {
        return true;
      }
    }
  }
  return false;
}

function flatten(lists: readonly (readonly number[])[]): [Int32Array, Int32Array] {
  const start = new Int32Array(lists.length + 1);
  let total = 0;
  lists.forEach((list, index) => {
    start[index] = total;
    total += list.length;
  });
  start[lists.length] = total;
  return [start, Int32Array.from(lists.flat())];
}
