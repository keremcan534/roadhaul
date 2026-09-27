import { SeededRandom } from '../../core/random/SeededRandom';
import type { Point2, VillageDefinition } from '../../data/definitions/MapDefinition';
import { JUNCTION_REACH_METERS, ROAD_CLEARANCE_METERS, type CountryPlan } from './countryPlan';
import { RoadPath } from './RoadPath';
import { angleFrom, tangentAt } from './sideRoads';

/**
 * The villages a map places (MapDefinition.villages): each a street lined
 * with houses, a bigger one now and then (a shop, the hall), and a green
 * beside it, with a country road from each end to the nearest road it can
 * reach round whatever is in the way. The towns' pavements, lamps and
 * furniture follow their streets, like any street's.
 */

/** A village where it grew: its name's id and where its name goes, the middle of its street. */
export interface Village {
  readonly id: string;
  readonly x: number;
  readonly z: number;
}

/** A village's street is this wide, meters, and its roads out this wide. */
const STREET_WIDTH_METERS = 9;
const ROAD_WIDTH_METERS = 7.5;
/** The street runs this far past its first and last houses, meters, and its control points lie at most this far apart. */
const STREET_END_METERS = 30;
const STREET_POINT_SPACING_METERS = 60;
/** It is at least this long, meters. */
const MIN_STREET_METERS = 160;
/** Houses stand this far apart along the street, meters, and this much further back than they must. */
const HOUSE_SPACING_METERS = [24, 32] as const;
const HOUSE_SETBACK_METERS = [0.5, 3.5] as const;
/** A building must stand this far from the street's edge (CountryPlan's clearance), meters. */
const BUILDING_ROAD_CLEARANCE_METERS = 6.5;
/** Every this-many-th building along a side is a bigger one: a shop, the hall. */
const HALL_EVERY = 4;
/** Sizes: along the street, across it, and height, meters. */
const HOUSE = { length: [10, 13], width: [8, 10], height: [5, 7.5] } as const;
const HALL = { length: [15, 19], width: [10, 12], height: [7, 9] } as const;
/** A village's green is this long along the street and this deep, set back this far from its edge, meters. */
const GREEN_LENGTH_METERS = 88;
const GREEN_DEPTH_METERS = 60;
const GREEN_SETBACK_METERS = 7;
/** A road out leaves the street straight on for this long, meters, and meets the road it joins square from this far out. */
const LEAVE_METERS = 45;
const APPROACH_METERS = 45;
/** It joins a road within this far of the street's end, meters, finding ways to the nearest few places. */
const JOIN_REACH_METERS = 2400;
const JOIN_TRIES = 3;
/**
 * The places looked at on each road: in each stretch this long, meters,
 * every this-many-th sample, the nearest this many of them, until one can
 * be joined square.
 */
const JOIN_STRETCH_METERS = 400;
const JUNCTION_SAMPLE_STEP = 3;
const JUNCTION_LOOKS = 12;
/** A road out leaves the street's end turning up to this much toward where it heads, radians… */
const MAX_LEAVE_TURN = 1.4;
/** …for a road this far off the way the street runs out at most. */
const MAX_HEADING_OFF = 1.75;
/** Its corners wind up to this far either side of the way found, meters. */
const MEANDER_METERS = 16;
/** Roads may be joined no nearer their ends than this: a map's country road (in the towns), a new one. */
const MAP_ROAD_END_CLEARANCE_METERS = 260;
const NEW_ROAD_END_CLEARANCE_METERS = 150;
/** A road out turns at most this much at any of its corners, radians. */
const MAX_CORNER_TURN = 1.75;

/**
 * Grows `villages` on `plan`'s land, in order, from `seed`. Returns the
 * villages that grew: one whose street has no room, or no road that can
 * reach another, is left out.
 */
export function growVillages(plan: CountryPlan, villages: readonly VillageDefinition[], seed: number): Village[] {
  const random = new SeededRandom(seed);
  const grown: Village[] = [];
  for (const village of villages) {
    if (growVillage(plan, village, new SeededRandom(random.int(0, 0x7fffffff)))) {
      grown.push({ id: village.id, x: village.x, z: village.z });
    }
  }
  return grown;
}

function growVillage(plan: CountryPlan, village: VillageDefinition, random: SeededRandom): boolean {
  const heading = (village.headingDegrees * Math.PI) / 180;
  // Square to the map: exactly along x or z.
  const dx = Math.round(Math.sin(heading));
  const dz = Math.round(Math.cos(heading));
  const perSide = Math.ceil(village.houses / 2);
  const length = Math.max(MIN_STREET_METERS, perSide * ((HOUSE_SPACING_METERS[0] + HOUSE_SPACING_METERS[1]) / 2) + STREET_END_METERS * 2);
  const pieces = Math.ceil(length / STREET_POINT_SPACING_METERS);
  const points: Point2[] = [];
  for (let i = 0; i <= pieces; i++) {
    const along = -length / 2 + (length * i) / pieces;
    points.push([village.x + dx * along, village.z + dz * along]);
  }
  const street = new RoadPath({
    id: `${village.id}_street`,
    kind: 'street',
    widthMeters: STREET_WIDTH_METERS,
    closed: false,
    controlPoints: points,
  });
  if (!plan.isClearForRoad(street.x(0), street.z(0)) || plan.firstBlockedSample(street) >= 0) {
    return false;
  }
  // A road out of each end; the one that can reach a road nearest first, and the village only if one can.
  const ends = [
    { x: points[points.length - 1]![0], z: points[points.length - 1]![1], outX: dx, outZ: dz, atStart: false },
    { x: points[0]![0], z: points[0]![1], outX: -dx, outZ: -dz, atStart: true },
  ];
  const first = ends
    .map((end) => ({ end, road: roadOut(plan, end.x, end.z, end.outX, end.outZ, NOTHING, random) }))
    .filter((planned) => planned.road !== null)
    .sort((a, b) => routeLength(a.road!.points) - routeLength(b.road!.points))[0];
  if (first === undefined) {
    return false;
  }
  const firstRoad = new RoadPath({ id: `${village.id}_road_1`, kind: 'rural', widthMeters: ROAD_WIDTH_METERS, closed: false, controlPoints: first.road!.points });
  // It was found before the street was there: it must keep clear of it too.
  if (!keepsClear(firstRoad, street, first.end.x, first.end.z)) {
    return false;
  }
  const own = new Set([plan.addRoad(street), plan.addRoad(firstRoad)]);
  // The other end's road leads elsewhere: to another road than the first joins, where one is near enough.
  const other = ends.find((end) => end !== first.end)!;
  const second =
    roadOut(plan, other.x, other.z, other.outX, other.outZ, new Set([...own, first.road!.roadIndex]), random) ??
    roadOut(plan, other.x, other.z, other.outX, other.outZ, own, random);
  if (second === null) {
    plan.addTurningCircle(street, other.atStart);
  } else {
    plan.addRoad(new RoadPath({ id: `${village.id}_road_2`, kind: 'rural', widthMeters: ROAD_WIDTH_METERS, closed: false, controlPoints: second.points }));
  }
  // Its green beside the middle of the street, on whichever side has room; then its houses.
  const acrossX = -dz;
  const acrossZ = dx;
  if (village.green === true) {
    const offset = STREET_WIDTH_METERS / 2 + GREEN_SETBACK_METERS + GREEN_DEPTH_METERS / 2;
    for (const side of random.next() < 0.5 ? [1, -1] : [-1, 1]) {
      const green = {
        id: `${village.id}_green`,
        area: {
          x: village.x + acrossX * side * offset,
          z: village.z + acrossZ * side * offset,
          headingDegrees: village.headingDegrees,
          lengthMeters: GREEN_LENGTH_METERS,
          widthMeters: GREEN_DEPTH_METERS,
        },
      };
      if (plan.tryPark(green)) {
        break;
      }
    }
  }
  for (const side of [1, -1]) {
    let count = 0;
    for (let along = STREET_END_METERS; along <= length - STREET_END_METERS; along += random.range(HOUSE_SPACING_METERS[0], HOUSE_SPACING_METERS[1])) {
      const size = ++count % HALL_EVERY === 0 ? HALL : HOUSE;
      const alongSize = random.range(size.length[0], size.length[1]);
      const acrossSize = random.range(size.width[0], size.width[1]);
      const offset =
        STREET_WIDTH_METERS / 2 +
        BUILDING_ROAD_CLEARANCE_METERS +
        random.range(HOUSE_SETBACK_METERS[0], HOUSE_SETBACK_METERS[1]) +
        acrossSize / 2;
      const x = points[0]![0] + dx * along + acrossX * side * offset;
      const z = points[0]![1] + dz * along + acrossZ * side * offset;
      const [sizeX, sizeZ] = dx !== 0 ? [alongSize, acrossSize] : [acrossSize, alongSize];
      plan.tryBuilding(x, z, sizeX, sizeZ, random.range(size.height[0], size.height[1]));
    }
  }
  return true;
}

/**
 * A country road's control points from a village street's end (x, z),
 * where the street runs out along (outX, outZ), to the nearest place it
 * can reach on another country road (but those in `avoid`), joining that
 * square; or null.
 */
function roadOut(
  plan: CountryPlan,
  x: number,
  z: number,
  outX: number,
  outZ: number,
  avoid: ReadonlySet<number>,
  random: SeededRandom,
): RoadOut | null {
  const out = Math.atan2(outX, outZ);
  const junctions: Junction[] = [];
  plan.roads.forEach((road, roadIndex) => {
    if (road.kind === 'rural' && !road.closed && !avoid.has(roadIndex)) {
      junctions.push(...junctionsOn(plan, road, roadIndex, x, z));
    }
  });
  // Only roads ahead of the street's end: one behind it is the other end's to reach.
  const ahead = junctions.filter(
    ({ approachX, approachZ }) => Math.abs(angleFrom(out, Math.atan2(approachX - x, approachZ - z))) <= MAX_HEADING_OFF,
  );
  ahead.sort((a, b) => a.distance - b.distance);
  for (const junction of ahead.slice(0, JOIN_TRIES)) {
    const { jx, jz, approachX, approachZ } = junction;
    // Straight on out of the street, or turning toward the road it heads for.
    const heading = out + clamp(angleFrom(out, Math.atan2(approachX - x, approachZ - z)), -MAX_LEAVE_TURN, MAX_LEAVE_TURN);
    const leaveX = x + Math.sin(heading) * LEAVE_METERS;
    const leaveZ = z + Math.cos(heading) * LEAVE_METERS;
    if (!plan.isClearRun(x, z, leaveX, leaveZ, x, z)) {
      continue;
    }
    const way = plan.router.route(leaveX, leaveZ, approachX, approachZ, (px, pz) => plan.isClearSinceLand(px, pz, x, z, jx, jz));
    if (way === null) {
      continue;
    }
    const straight: Point2[] = [[x, z], ...way, [jx, jz]];
    if (!gentle(straight)) {
      continue;
    }
    // Winding a little, where the land lets it; else as straight as the way was found.
    for (const wander of [MEANDER_METERS, MEANDER_METERS / 2, 0]) {
      const controlPoints = meander(straight, wander, random);
      const path = new RoadPath({ id: 'road', kind: 'rural', widthMeters: ROAD_WIDTH_METERS, closed: false, controlPoints });
      if (gentle(controlPoints) && plan.firstBlockedSample(path, x, z, jx, jz) < 0) {
        return { points: controlPoints, roadIndex: junction.roadIndex };
      }
    }
  }
  return null;
}

/**
 * The road through `points` with its corners between the third and the
 * third from last (not those leaving the street and meeting the road square)
 * moved up to `wander` meters either side of the way it runs.
 */
function meander(points: readonly Point2[], wander: number, random: SeededRandom): Point2[] {
  return points.map((point, index): Point2 => {
    // Consumed for every corner, so how far one moves does not depend on another.
    const offset = random.range(-wander, wander);
    if (index < 2 || index > points.length - 3 || wander === 0) {
      return point;
    }
    const [ax, az] = points[index - 1]!;
    const [bx, bz] = points[index + 1]!;
    const length = Math.hypot(bx - ax, bz - az) || 1;
    // Right of the way it runs is (-dz, dx).
    return [point[0] - ((bz - az) / length) * offset, point[1] + ((bx - ax) / length) * offset];
  });
}

/** A place a road may join `roadIndex`: where, the point square out from it toward the village, and how far off the village is. */
interface Junction {
  readonly roadIndex: number;
  readonly jx: number;
  readonly jz: number;
  readonly approachX: number;
  readonly approachZ: number;
  readonly distance: number;
}

/**
 * In each stretch of `road` (index `roadIndex`) within reach of (x, z),
 * the place nearest it where a road may join `road` square, from the side
 * (x, z) lies on.
 */
function junctionsOn(plan: CountryPlan, road: RoadPath, roadIndex: number, x: number, z: number): Junction[] {
  const clearance = roadIndex < plan.mapRoadCount ? MAP_ROAD_END_CLEARANCE_METERS : NEW_ROAD_END_CLEARANCE_METERS;
  const junctions: Junction[] = [];
  let stretch: number[] = [];
  const settle = (): void => {
    const nearest = stretch
      .map((sample) => ({ sample, distance: Math.hypot(road.x(sample) - x, road.z(sample) - z) }))
      .filter(({ distance }) => distance <= JOIN_REACH_METERS)
      .sort((a, b) => a.distance - b.distance);
    for (const { sample, distance } of nearest.slice(0, JUNCTION_LOOKS)) {
      const junction = junctionAt(plan, road, roadIndex, sample, x, z, distance);
      if (junction !== null) {
        junctions.push(junction);
        break;
      }
    }
    stretch = [];
  };
  for (let sample = 0; sample < road.pointCount; sample++) {
    const along = road.distances[sample]!;
    if (along < clearance || road.lengthMeters - along < clearance) {
      continue;
    }
    if (stretch.length > 0 && along - road.distances[stretch[0]!]! > JOIN_STRETCH_METERS) {
      settle();
    }
    if (sample % JUNCTION_SAMPLE_STEP === 0) {
      stretch.push(sample);
    }
  }
  settle();
  return junctions;
}

/** Road `roadIndex`'s sample `sample` as a place to join it square from (x, z)'s side, or null where a road may not. */
function junctionAt(plan: CountryPlan, road: RoadPath, roadIndex: number, sample: number, x: number, z: number, distance: number): Junction | null {
  const jx = road.x(sample);
  const jz = road.z(sample);
  if (!plan.canJunction(jx, jz, roadIndex)) {
    return null;
  }
  const [tangentX, tangentZ] = tangentAt(road, sample);
  let nx = -tangentZ;
  let nz = tangentX;
  if (nx * (x - jx) + nz * (z - jz) < 0) {
    nx = -nx;
    nz = -nz;
  }
  const approachX = jx + nx * APPROACH_METERS;
  const approachZ = jz + nz * APPROACH_METERS;
  if (!plan.isClearRun(approachX, approachZ, jx, jz, Number.NaN, Number.NaN, jx, jz)) {
    return null;
  }
  return { roadIndex, jx, jz, approachX, approachZ, distance };
}

const NOTHING: ReadonlySet<number> = new Set();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** A road out of a village: its control points, and the road it joins. */
interface RoadOut {
  readonly points: Point2[];
  readonly roadIndex: number;
}

/** Whether `road`, leaving `street` at (x, z), keeps a road's clearance from it everywhere further out. */
function keepsClear(road: RoadPath, street: RoadPath, x: number, z: number): boolean {
  const within = ROAD_CLEARANCE_METERS + street.widthMeters / 2;
  for (let i = 0; i < road.pointCount; i++) {
    if (Math.hypot(road.x(i) - x, road.z(i) - z) < JUNCTION_REACH_METERS) {
      continue;
    }
    for (let k = 0; k < street.pointCount; k++) {
      if (Math.hypot(road.x(i) - street.x(k), road.z(i) - street.z(k)) < within) {
        return false;
      }
    }
  }
  return true;
}

/** Whether the line through `points` turns at most MAX_CORNER_TURN at each corner. */
function gentle(points: readonly Point2[]): boolean {
  for (let i = 1; i < points.length - 1; i++) {
    const [ax, az] = points[i - 1]!;
    const [bx, bz] = points[i]!;
    const [cx, cz] = points[i + 1]!;
    if (Math.abs(angleFrom(Math.atan2(bx - ax, bz - az), Math.atan2(cx - bx, cz - bz))) > MAX_CORNER_TURN) {
      return false;
    }
  }
  return true;
}

/** How long the line through `points` is, meters. */
function routeLength(points: readonly Point2[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  }
  return length;
}
