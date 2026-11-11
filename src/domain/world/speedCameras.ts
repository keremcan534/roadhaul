import type { RoadKind } from '../../data/definitions/MapDefinition';
import type { Occupancy } from './countryside';
import { createRoadPoint, type RoadPath } from './RoadPath';
import type { RoadNetwork } from './RoadNetwork';
import { junctionsAlongRoads } from './roadSigns';

/**
 * A speed camera on its post beside a main road, and the warning signs
 * before it each way. It checks the traffic both ways, at its road's limit
 * (RoadEventService). `heading` is the way its lens looks (0 along +z).
 */
export interface SpeedCamera {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly radius: number;
  readonly roadIndex: number;
  /** Its distance along its road, meters, and where on the road it checks (the road's centre beside it). */
  readonly along: number;
  readonly roadX: number;
  readonly roadZ: number;
  /** The "speed camera" signs before it, one for each way's traffic, each facing it. */
  readonly signs: readonly CameraSign[];
}

export interface CameraSign {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly radius: number;
}

/** What a camera needs of the world: its roads, their junctions, and room on the verge. */
export interface CameraGround {
  readonly roads: readonly RoadPath[];
  readonly network: RoadNetwork;
  /** Whether a post may stand at (x, z): off every road, out of yards, fields, buildings and water. */
  isClear(x: number, z: number): boolean;
}

/** The roads with cameras: the main ones between the towns. */
const CAMERA_ROADS: ReadonlySet<RoadKind> = new Set<RoadKind>(['highway', 'rural', 'ringRoad']);
/** The first this far along a road, then one every so far, none nearer its end than this. */
const FIRST_METERS = 650;
const SPACING_METERS = 2400;
const END_METERS = 350;
/** Clear of junctions by this much: a camera checks the road, not the turns. */
const JUNCTION_METERS = 160;
/** Tried this far either side of where it would go, if there is no room there. */
const SHIFTS_METERS = [0, 40, -40, 80, -80, 130, -130] as const;
/** On the verge this far out from the road's edge; its post this thick. */
const OUT_METERS = 2.2;
const POST_RADIUS_METERS = 0.22;
/** The warning signs stand this far before the camera, on the traffic's right. */
const SIGN_AHEAD_METERS = 180;
const SIGN_OUT_METERS = 2.4;
const SIGN_RADIUS_METERS = 0.08;

/**
 * The speed cameras along the main roads, placed once from the roads: the
 * first well along each, then one every SPACING_METERS, each clear of
 * junctions and with room for its post and both warning signs (which join
 * `occupancy`: they are solid).
 */
export function placeSpeedCameras(ground: CameraGround, occupancy: Occupancy): SpeedCamera[] {
  const cameras: SpeedCamera[] = [];
  const junctions = junctionsAlongRoads(ground);
  const point = createRoadPoint();
  /** The point `out` beyond the edge of `road` at `along`, on the right of the traffic driving `way`, facing it. */
  const verge = (road: RoadPath, along: number, way: 1 | -1, out: number) => {
    road.pointAt(along, point);
    const tx = point.directionX * way;
    const tz = point.directionZ * way;
    const offset = road.widthMeters / 2 + out;
    return { x: point.x - tz * offset, z: point.z + tx * offset, heading: Math.atan2(-tx, -tz), roadX: point.x, roadZ: point.z };
  };
  const roomFor = (x: number, z: number, radius: number): boolean => ground.isClear(x, z) && occupancy.isFree(x, z, radius, 0.6);
  ground.roads.forEach((road, roadIndex) => {
    if (road.closed || !CAMERA_ROADS.has(road.kind) || road.lengthMeters < FIRST_METERS + END_METERS) {
      return;
    }
    const alongs = junctions.get(roadIndex) ?? [];
    for (let planned = FIRST_METERS; planned < road.lengthMeters - END_METERS; planned += SPACING_METERS) {
      for (const shift of SHIFTS_METERS) {
        const along = planned + shift;
        if (
          along - SIGN_AHEAD_METERS < 0 ||
          along + SIGN_AHEAD_METERS > road.lengthMeters ||
          alongs.some((junction) => Math.abs(junction - along) < JUNCTION_METERS)
        ) {
          continue;
        }
        const post = verge(road, along, 1, OUT_METERS);
        const before = verge(road, along - SIGN_AHEAD_METERS, 1, SIGN_OUT_METERS);
        const after = verge(road, along + SIGN_AHEAD_METERS, -1, SIGN_OUT_METERS);
        if (!roomFor(post.x, post.z, POST_RADIUS_METERS) || !roomFor(before.x, before.z, SIGN_RADIUS_METERS) || !roomFor(after.x, after.z, SIGN_RADIUS_METERS)) {
          continue;
        }
        const signs = [before, after].map((sign) => ({ x: sign.x, z: sign.z, heading: sign.heading, radius: SIGN_RADIUS_METERS }));
        for (const thing of [post, ...signs]) {
          occupancy.add(thing.x, thing.z, thing === post ? POST_RADIUS_METERS : SIGN_RADIUS_METERS);
        }
        cameras.push({
          x: post.x,
          z: post.z,
          // It looks along the road, at the traffic coming toward the road's last point.
          heading: post.heading,
          radius: POST_RADIUS_METERS,
          roadIndex,
          along,
          roadX: post.roadX,
          roadZ: post.roadZ,
          signs,
        });
        break;
      }
    }
  });
  return cameras;
}

/** The solid parts of a camera: its post and its signs' posts. */
export function speedCameraPosts(camera: SpeedCamera): readonly { x: number; z: number; radius: number }[] {
  return [camera, ...camera.signs];
}
