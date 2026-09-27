import type { RoadKind } from '../../data/definitions/MapDefinition';
import type { Occupancy } from './countryside';
import type { RoadNetwork } from './RoadNetwork';
import { createRoadPoint, type RoadPath } from './RoadPath';
import type { TownEntry } from './townscape';

/**
 * The signs along the country roads (MapDefinition.scenery.roadSigns),
 * placed once from the roads, their junctions and the towns' name boards:
 * a warning triangle before each sharp bend of a country road for the
 * traffic heading into it, and chevron boards round the outside of the
 * sharpest bends (a lane's too); a warning before a crossroads or where a
 * country road joins; give way where a lane comes out on a road, stop
 * where a country road does; and direction boards: before the junctions of
 * the country roads, where each way leads and how far (the towns and the
 * villages), and just out of each town, what lies ahead. The towns' own
 * streets have none: their junctions are the towns'.
 */

/** What a small sign shows, as its traffic sees it. A chevron board's back shows its arrow to the other way's traffic. */
export const ROAD_SIGN_KINDS = [
  'bendLeft',
  'bendRight',
  'sideRoadLeft',
  'sideRoadRight',
  'crossroads',
  'giveWay',
  'stop',
  'chevron',
] as const;
export type RoadSignKind = (typeof ROAD_SIGN_KINDS)[number];

/**
 * A sign on a post beside the road, facing the traffic it is for (heading:
 * the way its face looks, 0 along +z); `radius` is its post's. A chevron
 * faces the traffic for which its bend turns left (its arrow points that
 * way), and shows its back to the other.
 */
export interface RoadSign {
  readonly kind: RoadSignKind;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly radius: number;
}

/** The way a direction board's row points: off to the left, straight on, off to the right. */
export const DIRECTION_ARROWS = ['left', 'ahead', 'right'] as const;
export type DirectionArrow = (typeof DIRECTION_ARROWS)[number];

export const SIGNED_PLACE_KINDS = ['city', 'village'] as const;
export type SignedPlaceKind = (typeof SIGNED_PLACE_KINDS)[number];

/** A row of a direction board: a town or village, the way to it (null on a board just out of a town), how far by road. */
export interface DirectionRow {
  readonly placeKind: SignedPlaceKind;
  /** The city's id (CityDefinition) or the village's (MapDefinition.villages). */
  readonly placeId: string;
  readonly arrow: DirectionArrow | null;
  /** Whole kilometres, at least 1. */
  readonly kilometers: number;
}

/** Boards on the highway are green, on the country roads blue. */
export const BOARD_TONES = ['blue', 'green'] as const;
export type BoardTone = (typeof BOARD_TONES)[number];

/** A direction board on two legs beside the road, facing the traffic coming (heading as a sign's), a row per place. */
export interface DirectionBoard {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly tone: BoardTone;
  readonly rows: readonly DirectionRow[];
}

/** A direction board is this wide; its legs, this thick, stand this far in from its ends. The truck hits the legs. */
export const DIRECTION_BOARD_WIDTH_METERS = 2.6;
export const DIRECTION_BOARD_LEG_RADIUS_METERS = 0.09;
const BOARD_LEG_INSET_METERS = 0.3;
/** A board names at most this many places. */
export const DIRECTION_BOARD_ROWS = 3;

/** Where a town's name board stands (DrivingWorld places it): the road, how far along, the traffic it greets, the town. */
export interface TownGate extends TownEntry {
  readonly cityId: string;
}

/** What placing the signs needs to know of the world. */
export interface SignGround {
  readonly roads: readonly RoadPath[];
  readonly network: RoadNetwork;
  /** The towns' name boards: a town is where the roads through them lead. */
  readonly townGates: readonly TownGate[];
  /** The villages' middles. */
  readonly villages: readonly { readonly id: string; readonly x: number; readonly z: number }[];
  /** Whether a sign's post may stand at (x, z): off every road, out of yards, fields, buildings and water. */
  isClear(x: number, z: number): boolean;
}

/** Small signs stand this far out from the road's edge (on the verge, past the reflector posts); their post is this thick. */
const SIGN_OUT_METERS = 2.4;
export const SIGN_POST_RADIUS_METERS = 0.07;
/** Small signs keep this far from what stands already (and a chevron from the next). */
const SIGN_GAP_METERS = 1.2;
/** A warning stands this far ahead of its bend or junction, or the next nearer where there is no room. */
const WARNING_AHEAD_METERS = [75, 62, 50, 40] as const;
/** Nothing is signed nearer a road's ends than this, nor (beyond the junction it is for) nearer a junction on it. */
const END_CLEARANCE_METERS = 15;
const JUNCTION_CLEARANCE_METERS = 22;
/**
 * Bends: the way the road turns is measured over this much of it, every
 * this many meters. A country road's bend sharper than this radius, turning
 * at least this much all told (radians), is warned of; bends turning the
 * same way this close together are one. Bends this near a road's ends go
 * unsigned: a lane squares up there to meet its road, a village's road its
 * street.
 */
const BEND_WINDOW_METERS = 24;
const BEND_STEP_METERS = 4;
const BEND_WARNING_RADIUS_METERS = 160;
const BEND_MIN_TURN = 0.45;
const BEND_JOIN_METERS = 40;
const BEND_END_CLEARANCE_METERS = 45;
/** A bend sharper than this (by the kind of road) has chevron boards round its outside, about this far apart, this far out. */
const CHEVRON_RADIUS_METERS: Readonly<Partial<Record<RoadKind, number>>> = { rural: 95, lane: 40 };
const CHEVRON_SPACING_METERS = 13;
const CHEVRON_OUT_METERS = 1.6;
const CHEVRON_COUNT = { least: 3, most: 7 } as const;
/** Give way and stop stand this far back from the edge of the road they meet. */
const MOUTH_BACK_METERS = 3.5;
/** A junction's ways are taken this far along each road from it. */
const BRANCH_LOOK_METERS = 15;
/** A way within this angle (radians) of straight on is ahead. */
const AHEAD_ANGLE = 0.6;
/** A way that runs nearer than this (the cosine across) along the road it leaves is on neither side. */
const SIDE_COSINE = 0.3;
/** Direction boards stand this far out from the road's edge (their middle), this far ahead of their junction or nearer. */
const BOARD_OUT_METERS = 3.4;
const BOARD_AHEAD_METERS = [95, 80, 65, 50] as const;
/** Boards keep this far from what stands already. */
const BOARD_GAP_METERS = 1.5;
/** Just out of a town, a board this far past its name board says what lies ahead (the nearer ones tried in turn). */
const OUT_OF_TOWN_METERS = [160, 190, 130, 220] as const;
/** A village is named just out of a town only this near. */
const OUT_OF_TOWN_VILLAGE_METERS = 3000;
/** A place nearer than this by road is not signed: the traffic is there, or all but. */
const NEAREST_SIGNED_METERS = 350;

/** A way out of a junction along one of its roads. */
interface Branch {
  readonly roadIndex: number;
  /** The junction's distance along the road, meters. */
  readonly along: number;
  /** 1: the way runs toward the road's last point; -1: toward its first. */
  readonly way: 1 | -1;
  /** Its direction away from the junction, a unit vector. */
  readonly dx: number;
  readonly dz: number;
  /** The node BRANCH_LOOK_METERS (or less) along it, and how far that is. */
  readonly node: number;
  readonly look: number;
}

/** A junction seen from its roads: its ways out, which roads pass through it, and whether it is in a town. */
interface JunctionWays {
  readonly branches: readonly Branch[];
  /** Per member road (by road index): whether it passes through (a way out each side) or ends here. */
  readonly through: ReadonlyMap<number, boolean>;
  readonly town: boolean;
}

/** A bend of a road: from and to (meters along), the way it turns (1: left, for the traffic toward the road's last point), how sharp. */
interface Bend {
  readonly from: number;
  readonly to: number;
  readonly turn: 1 | -1;
  readonly sharpestRadius: number;
}

/**
 * The small signs: warnings before the country roads' sharp bends and
 * their junctions, chevrons round the sharpest bends, and give way or stop
 * where a lane or a country road ends at another road. Each needs room
 * (SignGround.isClear, and clear of `occupancy`, which it joins: the signs
 * are solid, until knocked over).
 */
export function placeRoadSigns(ground: SignGround, occupancy: Occupancy): RoadSign[] {
  const signs: RoadSign[] = [];
  const point = createRoadPoint();
  const junctionAlongs = junctionsAlongRoads(ground);
  /** The sign `kind` for the traffic driving `way` along road `roadIndex` at `along`, `out` beyond its edge on the traffic's right. */
  const put = (roadIndex: number, along: number, way: 1 | -1, kind: RoadSignKind, out: number, junctionAlong: number | null): boolean => {
    const road = ground.roads[roadIndex]!;
    if (!roomAt(road, along, junctionAlongs.get(roadIndex) ?? [], junctionAlong)) {
      return false;
    }
    road.pointAt(along, point);
    // The traffic drives (tx, tz); its right is (-tz, tx), and the sign's face looks back at it.
    const tx = point.directionX * way;
    const tz = point.directionZ * way;
    const offset = road.widthMeters / 2 + out;
    const x = point.x - tz * offset;
    const z = point.z + tx * offset;
    if (!ground.isClear(x, z) || !occupancy.isFree(x, z, SIGN_POST_RADIUS_METERS, SIGN_GAP_METERS)) {
      return false;
    }
    signs.push({ kind, x, z, heading: Math.atan2(-tx, -tz), radius: SIGN_POST_RADIUS_METERS });
    occupancy.add(x, z, SIGN_POST_RADIUS_METERS);
    return true;
  };
  /** The first of WARNING_AHEAD_METERS before `at` (for the traffic driving `way`) with room, skipping those in `bends`. */
  const warn = (roadIndex: number, at: number, way: 1 | -1, kind: RoadSignKind, bends: readonly Bend[], junctionAlong: number | null): void => {
    for (const ahead of WARNING_AHEAD_METERS) {
      const along = at - way * ahead;
      if (!bends.some((bend) => along > bend.from - 10 && along < bend.to + 10) && put(roadIndex, along, way, kind, SIGN_OUT_METERS, junctionAlong)) {
        return;
      }
    }
  };

  // The bends: warnings on the country roads, chevrons round the sharpest (a lane's too).
  ground.roads.forEach((road, roadIndex) => {
    const chevronRadius = CHEVRON_RADIUS_METERS[road.kind];
    if (road.closed || (road.kind !== 'rural' && chevronRadius === undefined)) {
      return;
    }
    const bends = bendsOf(road);
    for (const bend of bends) {
      if (road.kind === 'rural') {
        // Toward the last point a left bend is `turn` 1; the other way it is a right bend.
        warn(roadIndex, bend.from, 1, bend.turn === 1 ? 'bendLeft' : 'bendRight', bends, null);
        warn(roadIndex, bend.to, -1, bend.turn === 1 ? 'bendRight' : 'bendLeft', bends, null);
      }
      if (chevronRadius !== undefined && bend.sharpestRadius < chevronRadius) {
        // Round the outside, facing the traffic for which the bend turns left: the outside is on its right.
        const length = bend.to - bend.from;
        const count = Math.max(CHEVRON_COUNT.least, Math.min(CHEVRON_COUNT.most, Math.round(length / CHEVRON_SPACING_METERS) + 1));
        for (let i = 0; i < count; i++) {
          put(roadIndex, bend.from + (length * (i + 0.5)) / count, bend.turn, 'chevron', CHEVRON_OUT_METERS, null);
        }
      }
    }
  });

  // The junctions out in the country: warnings on the roads through them, give way or stop on the roads ending there.
  for (const junction of ground.network.junctions) {
    const { branches, through, town } = junctionWays(ground, junction);
    if (town) {
      continue;
    }
    const majors = branches.filter((branch) => through.get(branch.roadIndex) === true && branch.way === 1);
    for (const major of majors) {
      const road = ground.roads[major.roadIndex]!;
      if (road.kind !== 'rural' && road.kind !== 'highway') {
        continue;
      }
      // Which sides the other roads leave on, for the traffic toward the road's last point: its right is (-dz, dx).
      let right = false;
      let left = false;
      let country = false;
      for (const other of branches) {
        if (other.roadIndex === major.roadIndex) {
          continue;
        }
        country ||= ground.roads[other.roadIndex]!.kind !== 'lane';
        const across = -other.dx * major.dz + other.dz * major.dx;
        right ||= across > SIDE_COSINE;
        left ||= across < -SIDE_COSINE;
      }
      // A lane off to one side is a farm's: warned of only where it crosses.
      if (!(right && left) && !country) {
        continue;
      }
      const forward: RoadSignKind = right && left ? 'crossroads' : right ? 'sideRoadRight' : 'sideRoadLeft';
      const backward: RoadSignKind = right && left ? 'crossroads' : right ? 'sideRoadLeft' : 'sideRoadRight';
      warn(major.roadIndex, major.along, 1, forward, [], major.along);
      warn(major.roadIndex, major.along, -1, backward, [], major.along);
    }
    // Give way or stop where a road ends at a country road (or the highway) passing through.
    const met = majors.filter((major) => ground.roads[major.roadIndex]!.kind === 'rural' || ground.roads[major.roadIndex]!.kind === 'highway');
    if (met.length === 0) {
      continue;
    }
    const widest = Math.max(...met.map((major) => ground.roads[major.roadIndex]!.widthMeters));
    for (const minor of branches) {
      const road = ground.roads[minor.roadIndex]!;
      if (through.get(minor.roadIndex) !== false || (road.kind !== 'lane' && road.kind !== 'rural')) {
        continue;
      }
      // The traffic arriving drives against the way out; the sign stands back from the road it meets.
      const arriving = minor.way === 1 ? -1 : 1;
      const back = widest / 2 + MOUTH_BACK_METERS;
      put(minor.roadIndex, minor.along + minor.way * back, arriving, road.kind === 'rural' ? 'stop' : 'giveWay', SIGN_OUT_METERS, minor.along);
    }
  }
  return signs;
}

/**
 * The direction boards: before the junctions where country roads meet, on
 * each of them, the places reached by each way on (the nearest of each
 * way first, then the others near enough, DIRECTION_BOARD_ROWS at most)
 * with the way's arrow and the distance by road; and just out of each
 * town, the places ahead. Each needs room for its legs (SignGround.isClear,
 * clear of `occupancy`, which they join: they are solid).
 */
export function placeDirectionBoards(ground: SignGround, occupancy: Occupancy): DirectionBoard[] {
  const boards: DirectionBoard[] = [];
  const places = signedPlaces(ground);
  if (places.length === 0) {
    return boards;
  }
  const point = createRoadPoint();
  const junctionAlongs = junctionsAlongRoads(ground);
  /** The board for the traffic driving `way` along road `roadIndex` at `along`, `rows` on it; false where there is no room. */
  const put = (roadIndex: number, along: number, way: 1 | -1, rows: DirectionRow[], junctionAlong: number | null): boolean => {
    const road = ground.roads[roadIndex]!;
    if (!roomAt(road, along, junctionAlongs.get(roadIndex) ?? [], junctionAlong)) {
      return false;
    }
    road.pointAt(along, point);
    const tx = point.directionX * way;
    const tz = point.directionZ * way;
    const offset = road.widthMeters / 2 + BOARD_OUT_METERS;
    const board: DirectionBoard = {
      x: point.x - tz * offset,
      z: point.z + tx * offset,
      heading: Math.atan2(-tx, -tz),
      tone: road.kind === 'highway' ? 'green' : 'blue',
      rows,
    };
    const legs = directionBoardLegs(board);
    if (!legs.every((leg) => ground.isClear(leg.x, leg.z) && occupancy.isFree(leg.x, leg.z, leg.radius, BOARD_GAP_METERS))) {
      return false;
    }
    boards.push(board);
    for (const leg of legs) {
      occupancy.add(leg.x, leg.z, leg.radius);
    }
    return true;
  };

  // Before the junctions of the country roads (three ways or more, lanes aside).
  for (const junction of ground.network.junctions) {
    const { branches, town } = junctionWays(ground, junction);
    const main = branches.filter((branch) => ground.roads[branch.roadIndex]!.kind !== 'lane');
    if (town || main.length < 3) {
      continue;
    }
    for (const approach of main) {
      for (const ahead of BOARD_AHEAD_METERS) {
        const rows = junctionRows(ground, places, branches, approach, ahead);
        if (rows.length === 0) {
          break;
        }
        // The board stands on the approach, `ahead` short of the junction, for the traffic driving toward it.
        if (put(approach.roadIndex, approach.along + approach.way * ahead, approach.way === 1 ? -1 : 1, rows, approach.along)) {
          break;
        }
      }
    }
  }

  // Just out of each town: what lies ahead.
  for (const gate of ground.townGates) {
    const road = ground.roads[gate.roadIndex]!;
    // Coming in, the traffic drives `inward` along the road; leaving, the other way.
    const inward = gate.direction === 'forward' ? 1 : -1;
    const leaving: 1 | -1 = inward === 1 ? -1 : 1;
    for (const past of OUT_OF_TOWN_METERS) {
      const along = gate.distanceMeters + leaving * past;
      if (along < 0 || along > road.lengthMeters) {
        continue;
      }
      const rows = aheadRows(ground, places, gate, along, leaving);
      if (rows.length === 0 || put(gate.roadIndex, along, leaving, rows, null)) {
        break;
      }
    }
  }
  return boards;
}

/** Where a direction board's legs stand (the truck hits them): either side of its middle, across its face. */
export function directionBoardLegs(board: DirectionBoard): { x: number; z: number; radius: number }[] {
  const reach = DIRECTION_BOARD_WIDTH_METERS / 2 - BOARD_LEG_INSET_METERS;
  return [-1, 1].map((leg) => ({
    x: board.x + Math.cos(board.heading) * leg * reach,
    z: board.z - Math.sin(board.heading) * leg * reach,
    radius: DIRECTION_BOARD_LEG_RADIUS_METERS,
  }));
}

/**
 * The bends of `road` sharper than BEND_WARNING_RADIUS_METERS that turn at
 * least BEND_MIN_TURN, clear of its ends, in order along it.
 */
function bendsOf(road: RoadPath): Bend[] {
  const point = createRoadPoint();
  const headingAt = (along: number): number => {
    road.pointAt(along, point);
    return Math.atan2(point.directionX, point.directionZ);
  };
  const half = BEND_WINDOW_METERS / 2;
  const found: { from: number; to: number; turn: 1 | -1; sharpest: number }[] = [];
  let current: { from: number; to: number; turn: 1 | -1; sharpest: number } | null = null;
  for (let along = half; along <= road.lengthMeters - half; along += BEND_STEP_METERS) {
    const curvature = wrapAngle(headingAt(along + half) - headingAt(along - half)) / BEND_WINDOW_METERS;
    if (Math.abs(curvature) * BEND_WARNING_RADIUS_METERS < 1) {
      continue;
    }
    const turn = curvature > 0 ? 1 : -1;
    if (current !== null && current.turn === turn && along - half - current.to <= BEND_JOIN_METERS) {
      current.to = along + half;
      current.sharpest = Math.max(current.sharpest, Math.abs(curvature));
    } else {
      current = { from: along - half, to: along + half, turn, sharpest: Math.abs(curvature) };
      found.push(current);
    }
  }
  return found
    .filter(
      (bend) =>
        bend.from >= BEND_END_CLEARANCE_METERS &&
        bend.to <= road.lengthMeters - BEND_END_CLEARANCE_METERS &&
        Math.abs(wrapAngle(headingAt(bend.to) - headingAt(bend.from))) >= BEND_MIN_TURN,
    )
    .map((bend) => ({ from: bend.from, to: bend.to, turn: bend.turn, sharpestRadius: 1 / bend.sharpest }));
}

/**
 * Whether a sign may stand `along` road `road`: clear of its ends and of the
 * junctions on it (`alongs`), all but the one it is for (`own`, at that
 * distance along it; null for none).
 */
function roomAt(road: RoadPath, along: number, alongs: readonly number[], own: number | null): boolean {
  // A road's end is clear of signs, but for the junction there it is for.
  const startIsOwn = own !== null && own < 1;
  const endIsOwn = own !== null && own > road.lengthMeters - 1;
  if (along < 0 || along > road.lengthMeters) {
    return false;
  }
  if ((along < END_CLEARANCE_METERS && !startIsOwn) || (along > road.lengthMeters - END_CLEARANCE_METERS && !endIsOwn)) {
    return false;
  }
  return alongs.every((junction) => junction === own || Math.abs(junction - along) >= JUNCTION_CLEARANCE_METERS);
}

/** Per road (by index), how far along it each junction on it is. */
function junctionsAlongRoads(ground: SignGround): Map<number, number[]> {
  const alongs = new Map<number, number[]>();
  for (const junction of ground.network.junctions) {
    for (const member of junction.members) {
      const along = ground.roads[member.roadIndex]!.distances[member.sampleIndex]!;
      const list = alongs.get(member.roadIndex);
      if (list === undefined) {
        alongs.set(member.roadIndex, [along]);
      } else {
        list.push(along);
      }
    }
  }
  return alongs;
}

/** The ways out of `junction`, which of its roads pass through it, and whether it is in a town (a street or ring road meets there). */
function junctionWays(ground: SignGround, junction: RoadNetwork['junctions'][number]): JunctionWays {
  const point = createRoadPoint();
  const branches: Branch[] = [];
  const through = new Map<number, boolean>();
  let town = false;
  for (const member of junction.members) {
    const road = ground.roads[member.roadIndex]!;
    town ||= road.kind === 'street' || road.kind === 'ringRoad';
    const last = road.pointCount - 1;
    const passes = road.closed || (member.sampleIndex > 0 && member.sampleIndex < last);
    through.set(member.roadIndex, passes);
    const along = road.distances[member.sampleIndex]!;
    const ways: (1 | -1)[] = passes ? [1, -1] : member.sampleIndex === 0 ? [1] : [-1];
    for (const way of ways) {
      const room = road.closed ? road.lengthMeters / 2 : way === 1 ? road.lengthMeters - along : along;
      const look = Math.min(BRANCH_LOOK_METERS, room);
      if (look < 1) {
        continue;
      }
      road.pointAt(along + way * look, point);
      const dx = point.x - junction.x;
      const dz = point.z - junction.z;
      const length = Math.hypot(dx, dz) || 1;
      branches.push({
        roadIndex: member.roadIndex,
        along,
        way,
        dx: dx / length,
        dz: dz / length,
        node: ground.network.nodeOf(member.roadIndex, sampleAt(road, along + way * look)),
        look,
      });
    }
  }
  return { branches, through, town };
}

/** The sample of `road` nearest `along` meters along it. */
function sampleAt(road: RoadPath, along: number): number {
  let low = 0;
  let high = road.pointCount - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (road.distances[middle]! <= along) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  const next = Math.min(low + 1, road.pointCount - 1);
  return along - road.distances[low]! <= road.distances[next]! - along ? low : next;
}

/** A place a board may name, and how far every node is from it by road. */
interface SignedPlace {
  readonly kind: SignedPlaceKind;
  readonly id: string;
  readonly distances: Float64Array;
}

/** The towns (reached at any of their name boards) and the villages (at their middle's nearest road). */
function signedPlaces(ground: SignGround): SignedPlace[] {
  const places: SignedPlace[] = [];
  const gatesByCity = new Map<string, number[]>();
  for (const gate of ground.townGates) {
    const road = ground.roads[gate.roadIndex]!;
    const node = ground.network.nodeOf(gate.roadIndex, sampleAt(road, gate.distanceMeters));
    const nodes = gatesByCity.get(gate.cityId);
    if (nodes === undefined) {
      gatesByCity.set(gate.cityId, [node]);
    } else {
      nodes.push(node);
    }
  }
  for (const [cityId, nodes] of gatesByCity) {
    places.push({ kind: 'city', id: cityId, distances: ground.network.distancesTo(nodes) });
  }
  for (const village of ground.villages) {
    const node = ground.network.nearestNode(village.x, village.z);
    if (node >= 0) {
      places.push({ kind: 'village', id: village.id, distances: ground.network.distancesTo([node]) });
    }
  }
  return places;
}

/**
 * A junction's board for the traffic arriving along `approach`, `ahead`
 * meters short of it: each place reached best by a way on (not back the way
 * the traffic came, nor down a lane), the nearest of each way first, then
 * the others by distance, towns before villages at the same distance; shown
 * ahead, then left, then right.
 */
function junctionRows(
  ground: SignGround,
  places: readonly SignedPlace[],
  branches: readonly Branch[],
  approach: Branch,
  ahead: number,
): DirectionRow[] {
  const candidates: { row: DirectionRow; meters: number }[] = [];
  for (const place of places) {
    let best: Branch | null = null;
    let bestMeters = Infinity;
    for (const branch of branches) {
      const meters = place.distances[branch.node]! + branch.look;
      if (meters < bestMeters) {
        bestMeters = meters;
        best = branch;
      }
    }
    if (best === null || best === approach || ground.roads[best.roadIndex]!.kind === 'lane' || bestMeters < NEAREST_SIGNED_METERS) {
      continue;
    }
    candidates.push({
      row: { placeKind: place.kind, placeId: place.id, arrow: arrowFor(approach, best), kilometers: kilometers(bestMeters + ahead) },
      meters: bestMeters,
    });
  }
  candidates.sort((a, b) => a.meters - b.meters || kindOrder(a.row) - kindOrder(b.row));
  const chosen: { row: DirectionRow; meters: number }[] = [];
  for (const arrow of DIRECTION_ARROWS) {
    const nearest = candidates.find((candidate) => candidate.row.arrow === arrow);
    if (nearest !== undefined && chosen.length < DIRECTION_BOARD_ROWS) {
      chosen.push(nearest);
    }
  }
  for (const candidate of candidates) {
    if (chosen.length >= DIRECTION_BOARD_ROWS) {
      break;
    }
    if (!chosen.includes(candidate)) {
      chosen.push(candidate);
    }
  }
  const arrowOrder: Readonly<Record<DirectionArrow, number>> = { ahead: 0, left: 1, right: 2 };
  return chosen
    .sort((a, b) => arrowOrder[a.row.arrow!] - arrowOrder[b.row.arrow!] || a.meters - b.meters)
    .map((candidate) => candidate.row);
}

/**
 * Just out of the town at `gate`, `along` its road, for the traffic leaving
 * (driving `leaving`): the places whose way on is ahead, the nearest
 * village (not too far) and then the towns, by distance.
 */
function aheadRows(ground: SignGround, places: readonly SignedPlace[], gate: TownGate, along: number, leaving: 1 | -1): DirectionRow[] {
  const road = ground.roads[gate.roadIndex]!;
  const nodeAt = (distance: number): number =>
    ground.network.nodeOf(gate.roadIndex, sampleAt(road, Math.max(0, Math.min(road.lengthMeters, distance))));
  const here = nodeAt(along);
  const onward = nodeAt(along + leaving * 20);
  const back = nodeAt(along - leaving * 20);
  const ahead = places
    .filter((place) => !(place.kind === 'city' && place.id === gate.cityId))
    .map((place) => ({ place, meters: place.distances[here]! }))
    .filter(
      ({ place, meters }) =>
        meters < Infinity && meters >= NEAREST_SIGNED_METERS && place.distances[onward]! < place.distances[back]! - 20,
    )
    .sort((a, b) => a.meters - b.meters);
  const village = ahead.find(({ place, meters }) => place.kind === 'village' && meters <= OUT_OF_TOWN_VILLAGE_METERS);
  const towns = ahead.filter(({ place }) => place.kind === 'city');
  return [...(village === undefined ? [] : [village]), ...towns]
    .slice(0, DIRECTION_BOARD_ROWS)
    .map(({ place, meters }) => ({ placeKind: place.kind, placeId: place.id, arrow: null, kilometers: kilometers(meters) }));
}

/** The arrow for the way `to` out of a junction, for the traffic arriving along `from`. */
function arrowFor(from: Branch, to: Branch): DirectionArrow {
  // Arriving, the traffic drives against `from`'s way out; a turn toward +x of that is to the left (headings grow leftward).
  const turn = wrapAngle(Math.atan2(to.dx, to.dz) - Math.atan2(-from.dx, -from.dz));
  return Math.abs(turn) <= AHEAD_ANGLE ? 'ahead' : turn > 0 ? 'left' : 'right';
}

function kilometers(meters: number): number {
  return Math.max(1, Math.round(meters / 1000));
}

function kindOrder(row: DirectionRow): number {
  return row.placeKind === 'city' ? 0 : 1;
}

/** `angle` brought into -π..π. */
function wrapAngle(angle: number): number {
  return angle - Math.round(angle / (2 * Math.PI)) * 2 * Math.PI;
}
