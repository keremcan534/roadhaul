import { SeededRandom } from '../../core/random/SeededRandom';
import type { RoadKind } from '../../data/definitions/MapDefinition';
import { createRoadPoint } from './RoadPath';
import { junctionsAlongRoads } from './roadSigns';
import type { CameraGround } from './speedCameras';

/** A thing of a work zone standing on the road or its verge, facing `heading` (0 along +z). */
export interface ZonePiece {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
}

/**
 * Road works for the day on a stretch of a main road: a line of cones along
 * one edge, a "road works" sign before each end, an arrow board at the
 * start and a roller on the verge. The road stays open, at a lower limit
 * (RoadEventService); the GPS goes round it where another way is not much
 * longer (RoadNetwork.setDetour).
 */
export interface WorkZone {
  readonly roadIndex: number;
  readonly fromAlong: number;
  readonly toAlong: number;
  /** Its middle on the road, the road's direction there, and half its length. */
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly halfLengthMeters: number;
  readonly cones: readonly ZonePiece[];
  readonly signs: readonly ZonePiece[];
  readonly arrowBoard: ZonePiece;
  readonly machine: ZonePiece;
  /** The road network's nodes along it (RoadNetwork.nodeOf). */
  readonly nodes: readonly number[];
}

/** Road works go on the main roads between the towns. */
const WORK_ROADS: ReadonlySet<RoadKind> = new Set<RoadKind>(['highway', 'rural', 'ringRoad']);
const LENGTH_METERS = 170;
/** Clear of the road's ends and its junctions, and of the speed cameras, by these. */
const END_METERS = 260;
const JUNCTION_METERS = 140;
const CAMERA_METERS = 350;
/** Tries this many places before giving up on a zone (a small map may have room for fewer). */
const TRIES = 40;
const CONE_SPACING_METERS = 9;
/** Cones stand this far inside the road's edge; the signs this far before the ends, out on the verge. */
const CONE_IN_METERS = 0.45;
const SIGN_AHEAD_METERS = 120;
const SIGN_OUT_METERS = 2.4;
const MACHINE_OUT_METERS = 4.5;

/**
 * Day `day`'s road works (a day number: the same day, the same works), up to
 * `count` of them, spread over the main roads by their length, clear of
 * the junctions, the roads' ends, each other and the speed cameras at
 * `cameras`.
 */
export function workZonesForDay(
  ground: Pick<CameraGround, 'roads' | 'network'>,
  day: number,
  count: number,
  cameras: readonly { readonly x: number; readonly z: number }[],
): WorkZone[] {
  const random = new SeededRandom(0x5eed + day * 7919);
  const roads = ground.roads
    .map((road, roadIndex) => ({ road, roadIndex }))
    .filter(({ road }) => !road.closed && WORK_ROADS.has(road.kind) && road.lengthMeters > 2 * END_METERS + LENGTH_METERS);
  const total = roads.reduce((sum, { road }) => sum + road.lengthMeters, 0);
  const zones: WorkZone[] = [];
  if (total <= 0) {
    return zones;
  }
  const junctions = junctionsAlongRoads(ground);
  const point = createRoadPoint();
  for (let tries = 0; tries < TRIES && zones.length < count; tries++) {
    // A road picked by its length, a place along it.
    let pick = random.next() * total;
    const chosen = roads.find(({ road }) => (pick -= road.lengthMeters) < 0) ?? roads[roads.length - 1]!;
    const { road, roadIndex } = chosen;
    const middle = random.range(END_METERS + LENGTH_METERS / 2, road.lengthMeters - END_METERS - LENGTH_METERS / 2);
    const fromAlong = middle - LENGTH_METERS / 2;
    const toAlong = middle + LENGTH_METERS / 2;
    if ((junctions.get(roadIndex) ?? []).some((junction) => junction > fromAlong - JUNCTION_METERS && junction < toAlong + JUNCTION_METERS)) {
      continue;
    }
    road.pointAt(middle, point);
    const x = point.x;
    const z = point.z;
    const near = (other: { readonly x: number; readonly z: number }, meters: number): boolean => Math.hypot(other.x - x, other.z - z) < meters;
    if (cameras.some((camera) => near(camera, CAMERA_METERS)) || zones.some((zone) => near(zone, 2 * LENGTH_METERS))) {
      continue;
    }
    const heading = Math.atan2(point.directionX, point.directionZ);
    /** A piece `out` from the road's centre at `along`, on the right of the traffic driving `way`, facing it. */
    const piece = (along: number, way: 1 | -1, out: number): ZonePiece => {
      road.pointAt(along, point);
      const tx = point.directionX * way;
      const tz = point.directionZ * way;
      return { x: point.x - tz * out, z: point.z + tx * out, heading: Math.atan2(-tx, -tz) };
    };
    const edge = road.widthMeters / 2;
    const cones: ZonePiece[] = [];
    for (let along = fromAlong; along <= toAlong + 1e-6; along += CONE_SPACING_METERS) {
      cones.push(piece(along, 1, edge - CONE_IN_METERS));
    }
    const nodes: number[] = [];
    for (let sample = 0; sample < road.pointCount; sample++) {
      const along = road.distances[sample]!;
      if (along >= fromAlong && along <= toAlong) {
        nodes.push(ground.network.nodeOf(roadIndex, sample));
      }
    }
    zones.push({
      roadIndex,
      fromAlong,
      toAlong,
      x,
      z,
      heading,
      halfLengthMeters: LENGTH_METERS / 2,
      cones,
      signs: [piece(fromAlong - SIGN_AHEAD_METERS, 1, edge + SIGN_OUT_METERS), piece(toAlong + SIGN_AHEAD_METERS, -1, edge + SIGN_OUT_METERS)],
      arrowBoard: piece(fromAlong - 6, 1, edge + 1.2),
      machine: piece(middle, 1, edge + MACHINE_OUT_METERS),
      nodes,
    });
  }
  return zones;
}
