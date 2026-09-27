import { SeededRandom } from '../../core/random/SeededRandom';
import type { Point2 } from '../../data/definitions/MapDefinition';
import type { Occupancy, SceneryGround } from './countryside';
import type { RoadNetwork } from './RoadNetwork';
import { createRoadPoint, type RoadPath } from './RoadPath';

/**
 * The country roads' edges, part of the countryside (MapDefinition
 * .scenery.countryside), placed once from the map's seed after everything
 * else of it: hedgerows along the open stretches of the country roads and
 * the lanes, broken round what stands; gate pillars and a mailbox where a
 * lane leaves its road for a farm or a hamlet; and a post-and-wire fence
 * along the highway. The hedges and the fence are scenery the truck drives
 * through, like the fields' fences; the pillars are solid and the mailbox
 * gives way.
 */

/** A hedgerow beside a road: its line, a point every HEDGE_STEP_METERS. Drawn wild and uneven. */
export interface Hedgerow {
  readonly points: readonly Point2[];
}

/** A stone gate pillar at a farm lane's mouth. */
export interface GatePillar {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/** A mailbox on its post, its front (the lid) toward the road it stands by (heading: the way it faces, 0 along +z). */
export interface Mailbox {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly radius: number;
}

/** Where a lane leaves its road for a farm (or a hamlet): two pillars either side of it, a mailbox by one, facing the road. */
export interface FarmGate {
  readonly pillars: readonly [GatePillar, GatePillar];
  readonly mailbox: Mailbox;
  /** The way into the lane, radians (0 along +z). */
  readonly heading: number;
}

/** A post-and-wire fence along a road: a post at each point, three wires between them. */
export interface RoadFence {
  readonly points: readonly Point2[];
}

/** What placing the roads' edges needs to know of the world. */
export interface RoadsideGround extends SceneryGround {
  readonly network: RoadNetwork;
  /** Whether something may stand right beside a road at (x, z) (a gate's pillar): off every road by a little, out of yards, fields and buildings. */
  isClearBeside(x: number, z: number): boolean;
}

/** Hedgerows: a point every this many meters, this far out from the road's edge (a run's own, within this). */
export const HEDGE_STEP_METERS = 4;
const HEDGE_OUT_METERS = [9, 11] as const;
/** A road's side is hedged in runs this long, this far apart, this share of them grown; shorter pieces are left out. */
const HEDGE_RUN_METERS = [60, 240] as const;
const HEDGE_GAP_METERS = [15, 100] as const;
const HEDGE_SHARE = 0.7;
const HEDGE_LEAST_METERS = 24;
/** A hedge keeps this far from what stands (its trunks and posts break it), and from the junctions and ends of its road. */
const HEDGE_ROOM_METERS = 0.9;
const HEDGE_JUNCTION_CLEARANCE_METERS = 30;
/** Gate pillars: this far into the lane past the edge of the road it leaves, this far out from the lane's edge, this thick. */
const GATE_IN_METERS = 7;
const GATE_OUT_METERS = 1.2;
export const GATE_PILLAR_RADIUS_METERS = 0.3;
/** The mailbox stands this far beyond its pillar, and this thick. */
const MAILBOX_BESIDE_METERS = 1.3;
export const MAILBOX_RADIUS_METERS = 0.14;
/** The highway's fence: this far out from its edge, a post every this many meters, clear of its junctions by this much. */
const FENCE_OUT_METERS = 14;
export const FENCE_POST_SPACING_METERS = 4;
const FENCE_JUNCTION_CLEARANCE_METERS = 45;
const FENCE_LEAST_METERS = 40;

/** Per road (by index), how far along it each junction on it is. */
function junctionAlongs(roads: readonly RoadPath[], network: RoadNetwork): Map<number, number[]> {
  const alongs = new Map<number, number[]>();
  for (const junction of network.junctions) {
    for (const member of junction.members) {
      const along = roads[member.roadIndex]!.distances[member.sampleIndex]!;
      alongs.set(member.roadIndex, [...(alongs.get(member.roadIndex) ?? []), along]);
    }
  }
  return alongs;
}

/**
 * Walks a line `out` meters beside `road` (right of its direction for
 * `side` 1, left for -1) from `from` to `to` meters along it, a point every
 * `step`, and gives the pieces where `room` says a point may be, those at
 * least `least` long.
 */
function linesBeside(
  road: RoadPath,
  side: 1 | -1,
  out: number,
  from: number,
  to: number,
  step: number,
  least: number,
  room: (x: number, z: number, along: number) => boolean,
): Point2[][] {
  const point = createRoadPoint();
  const pieces: Point2[][] = [];
  let piece: Point2[] = [];
  const close = (): void => {
    if ((piece.length - 1) * step >= least) {
      pieces.push(piece);
    }
    piece = [];
  };
  const offset = side * (road.widthMeters / 2 + out);
  for (let along = from; along <= to; along += step) {
    road.pointAt(along, point);
    // Right of the road's direction is (-dz, dx).
    const x = point.x - point.directionZ * offset;
    const z = point.z + point.directionX * offset;
    if (room(x, z, along)) {
      piece.push([x, z]);
    } else {
      close();
    }
  }
  close();
  return pieces;
}

/**
 * Hedgerows along both sides of the country roads and the lanes, in runs
 * of seeded length and spacing, a share of them grown, each at its own
 * distance out; broken where a point has no room (another road, a field, a
 * yard, a building, the water; what stands, filed in `occupancy`) and kept
 * clear of the junctions and the roads' ends. Scenery: not filed.
 */
export function placeHedgerows(ground: RoadsideGround, occupancy: Occupancy, seed: number): Hedgerow[] {
  const hedges: Hedgerow[] = [];
  const alongs = junctionAlongs(ground.roads, ground.network);
  ground.roads.forEach((road, roadIndex) => {
    if ((road.kind !== 'rural' && road.kind !== 'lane') || road.closed) {
      return;
    }
    const junctions = alongs.get(roadIndex) ?? [];
    const clearOfJunctions = (along: number): boolean =>
      along >= HEDGE_JUNCTION_CLEARANCE_METERS &&
      along <= road.lengthMeters - HEDGE_JUNCTION_CLEARANCE_METERS &&
      junctions.every((junction) => Math.abs(junction - along) >= HEDGE_JUNCTION_CLEARANCE_METERS);
    for (const side of [1, -1] as const) {
      // Each side of each road from its own seed: one road's hedges move no other's.
      const random = new SeededRandom((seed ^ 0x4ed9e) + roadIndex * 7919 + (side === 1 ? 0 : 104729));
      let along = random.range(0, HEDGE_GAP_METERS[1]);
      while (along < road.lengthMeters) {
        const length = random.range(HEDGE_RUN_METERS[0], HEDGE_RUN_METERS[1]);
        const out = random.range(HEDGE_OUT_METERS[0], HEDGE_OUT_METERS[1]);
        const grown = random.next() < HEDGE_SHARE;
        if (grown) {
          const pieces = linesBeside(road, side, out, along, Math.min(road.lengthMeters, along + length), HEDGE_STEP_METERS, HEDGE_LEAST_METERS, (x, z, at) =>
            clearOfJunctions(at) && ground.isClear(x, z) && occupancy.isFree(x, z, 0, HEDGE_ROOM_METERS),
          );
          hedges.push(...pieces.map((points) => ({ points })));
        }
        along += length + random.range(HEDGE_GAP_METERS[0], HEDGE_GAP_METERS[1]);
      }
    }
  });
  return hedges;
}

/**
 * Where each lane that ends at a farm or a hamlet (a dead end) leaves its
 * road: two stone pillars either side of it a little way in, and a mailbox
 * on the right of the traffic turning in, facing the road. Each needs room
 * (RoadsideGround.isClearBeside, and `occupancy`, which its pillars and
 * mailbox join: they are solid, the mailbox until knocked over).
 */
export function placeFarmGates(ground: RoadsideGround, occupancy: Occupancy): FarmGate[] {
  const gates: FarmGate[] = [];
  const point = createRoadPoint();
  const deadEnds = new Set(ground.network.deadEnds.map(({ roadIndex, sampleIndex }) => `${roadIndex}:${sampleIndex}`));
  for (const junction of ground.network.junctions) {
    for (const member of junction.members) {
      const lane = ground.roads[member.roadIndex]!;
      const last = lane.pointCount - 1;
      if (lane.kind !== 'lane' || (member.sampleIndex !== 0 && member.sampleIndex !== last)) {
        continue;
      }
      // Its other end is the farm's (or the hamlet's) turning circle.
      const farmEnd = member.sampleIndex === 0 ? last : 0;
      if (!deadEnds.has(`${member.roadIndex}:${farmEnd}`)) {
        continue;
      }
      const met = junction.members.filter((other) => other.roadIndex !== member.roadIndex).map((other) => ground.roads[other.roadIndex]!);
      const widest = Math.max(0, ...met.map((road) => road.widthMeters));
      // Into the lane from the junction: toward its farm end.
      const inward = member.sampleIndex === 0 ? 1 : -1;
      const along = member.sampleIndex === 0 ? widest / 2 + GATE_IN_METERS : lane.lengthMeters - widest / 2 - GATE_IN_METERS;
      if (along <= 0 || along >= lane.lengthMeters) {
        continue;
      }
      lane.pointAt(along, point);
      const ix = point.directionX * inward;
      const iz = point.directionZ * inward;
      // Right of the way in is (-iz, ix).
      const reach = lane.widthMeters / 2 + GATE_OUT_METERS;
      const pillars = [1, -1].map((side) => ({
        x: point.x - iz * reach * side,
        z: point.z + ix * reach * side,
        radius: GATE_PILLAR_RADIUS_METERS,
      })) as [GatePillar, GatePillar];
      const beside = reach + MAILBOX_BESIDE_METERS;
      // A little nearer the road than the pillars, facing it.
      const mailbox = {
        x: point.x - iz * beside - ix * 0.6,
        z: point.z + ix * beside - iz * 0.6,
        heading: Math.atan2(-ix, -iz),
        radius: MAILBOX_RADIUS_METERS,
      };
      const standing = [...pillars, mailbox];
      if (!standing.every((thing) => ground.isClearBeside(thing.x, thing.z) && occupancy.isFree(thing.x, thing.z, thing.radius, 0.5))) {
        continue;
      }
      for (const thing of standing) {
        occupancy.add(thing.x, thing.z, thing.radius);
      }
      gates.push({ pillars, mailbox, heading: Math.atan2(ix, iz) });
    }
  }
  return gates;
}

/**
 * A post-and-wire fence along both sides of the highway, FENCE_OUT_METERS
 * out, a post every FENCE_POST_SPACING_METERS, broken where a post has no
 * room and clear of the highway's junctions. Scenery: not filed.
 */
export function placeRoadFences(ground: RoadsideGround, occupancy: Occupancy): RoadFence[] {
  const fences: RoadFence[] = [];
  const alongs = junctionAlongs(ground.roads, ground.network);
  ground.roads.forEach((road, roadIndex) => {
    if (road.kind !== 'highway' || road.closed) {
      return;
    }
    const junctions = alongs.get(roadIndex) ?? [];
    for (const side of [1, -1] as const) {
      const pieces = linesBeside(road, side, FENCE_OUT_METERS, 0, road.lengthMeters, FENCE_POST_SPACING_METERS, FENCE_LEAST_METERS, (x, z, along) =>
        junctions.every((junction) => Math.abs(junction - along) >= FENCE_JUNCTION_CLEARANCE_METERS) &&
        ground.isClear(x, z) &&
        occupancy.isFree(x, z, 0, 0.6),
      );
      fences.push(...pieces.map((points) => ({ points })));
    }
  });
  return fences;
}
