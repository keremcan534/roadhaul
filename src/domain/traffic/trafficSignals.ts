import type { DrivingWorld } from '../world/DrivingWorld';
import type { LaneGraph } from './LaneGraph';

/**
 * Traffic lights at the town streets' junctions (MapDefinition.scenery
 * .trafficSignals): the approaches running mostly along z (group 0) and
 * those mostly along x (group 1) take turns, green, amber, then a moment of
 * red both ways. Every junction keeps the same time, so the lights change
 * together.
 */
export const SIGNAL_GREEN_SECONDS = 18;
export const SIGNAL_AMBER_SECONDS = 3;
/** Red both ways between the two groups' turns, seconds: the junction clears. */
export const SIGNAL_ALL_RED_SECONDS = 1;
export const SIGNAL_CYCLE_SECONDS = 2 * (SIGNAL_GREEN_SECONDS + SIGNAL_AMBER_SECONDS + SIGNAL_ALL_RED_SECONDS);

/** What a light shows. */
export const GREEN_LIGHT = 0;
export const AMBER_LIGHT = 1;
export const RED_LIGHT = 2;
export type SignalLight = typeof GREEN_LIGHT | typeof AMBER_LIGHT | typeof RED_LIGHT;

/** What group `group`'s lights show `seconds` into the traffic's time. Allocation-free. */
export function signalLight(seconds: number, group: number): SignalLight {
  const half = SIGNAL_CYCLE_SECONDS / 2;
  const t = (((seconds - group * half) % SIGNAL_CYCLE_SECONDS) + SIGNAL_CYCLE_SECONDS) % SIGNAL_CYCLE_SECONDS;
  if (t < SIGNAL_GREEN_SECONDS) {
    return GREEN_LIGHT;
  }
  return t < SIGNAL_GREEN_SECONDS + SIGNAL_AMBER_SECONDS ? AMBER_LIGHT : RED_LIGHT;
}

/** A signal head on its pole, beside an approach's stop line on the kerb, facing the traffic coming in. */
export interface SignalHead {
  readonly x: number;
  readonly z: number;
  /** The ground's (the road's) height there. */
  readonly y: number;
  /** The way it faces: 0 faces +Z, π/2 faces +X. */
  readonly heading: number;
  readonly group: number;
}

export interface TrafficSignals {
  /** Per link: the group of the lights a lane ends at (0 or 1), or -1 (no lights there, or not a lane). */
  readonly groupOf: Int8Array;
  readonly heads: readonly SignalHead[];
  /** How many junctions have lights. */
  readonly junctionCount: number;
}

/** The road kinds whose junctions take lights where they cross: the town's. */
const SIGNALLED_KINDS: ReadonlySet<string> = new Set(['street', 'ringRoad']);
/** A head stands this far out past the kerb, meters. */
const HEAD_OUT_METERS = 1.1;

/**
 * Where `world` has traffic lights, by `graph`'s lanes: at every junction of
 * town streets (no highway among them) approached along both axes. Null on a
 * map without them.
 */
export function placeTrafficSignals(graph: LaneGraph, world: DrivingWorld): TrafficSignals | null {
  if (!world.trafficSignals) {
    return null;
  }
  const junctions = world.network.junctions;
  const groupOf = new Int8Array(graph.linkCount).fill(-1);
  const heads: SignalHead[] = [];
  const lanesInto: number[][] = junctions.map(() => []);
  for (let link = 0; link < graph.linkCount; link++) {
    const node = graph.node[link]!;
    if (!graph.isTurn(link) && node >= 0 && node < junctions.length) {
      lanesInto[node]!.push(link);
    }
  }
  let junctionCount = 0;
  junctions.forEach((junction, node) => {
    const lanes = lanesInto[node]!;
    if (!junction.members.every((member) => SIGNALLED_KINDS.has(world.roads[member.roadIndex]!.kind))) {
      return;
    }
    const groups = lanes.map((lane) => {
      const [dx, dz] = endDirection(graph, lane);
      return Math.abs(dz) >= Math.abs(dx) ? 0 : 1;
    });
    if (!groups.includes(0) || !groups.includes(1)) {
      return; // One way through (a bend, a fork): nothing to take turns over.
    }
    junctionCount++;
    lanes.forEach((lane, index) => {
      const group = groups[index]!;
      groupOf[lane] = group;
      if (graph.laneIndex[lane] !== 0) {
        return; // One head an approach, by its rightmost lane.
      }
      const last = graph.pointStart[lane + 1]! - 1;
      const [dx, dz] = endDirection(graph, lane);
      // Right of the way the traffic drives (dx, dz) is (-dz, dx); the kerb is the rightmost lane's edge.
      const out = graph.laneWidth[lane]! / 2 + HEAD_OUT_METERS;
      heads.push({
        x: graph.pointX[last]! - dz * out,
        z: graph.pointZ[last]! + dx * out,
        y: graph.pointY[last]!,
        heading: Math.atan2(-dx, -dz),
        group,
      });
    });
  });
  return { groupOf, heads, junctionCount };
}

/** The way a lane runs at its end, a unit vector (x, z). */
function endDirection(graph: LaneGraph, lane: number): [number, number] {
  const last = graph.pointStart[lane + 1]! - 1;
  const first = graph.pointStart[lane]!;
  const before = Math.max(first, last - 1);
  const dx = graph.pointX[last]! - graph.pointX[before]!;
  const dz = graph.pointZ[last]! - graph.pointZ[before]!;
  const length = Math.hypot(dx, dz) || 1;
  return [dx / length, dz / length];
}
