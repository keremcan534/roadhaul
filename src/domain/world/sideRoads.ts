import { SeededRandom } from '../../core/random/SeededRandom';
import { FIELD_CROPS, type FieldDefinition, type Point2, type RoadSide } from '../../data/definitions/MapDefinition';
import { JUNCTION_REACH_METERS, ROAD_CLEARANCE_METERS, type CountryPlan } from './countryPlan';
import { fieldArea } from './fields';
import { createRoadPoint, RoadPath } from './RoadPath';

/**
 * The country's side roads (MapDefinition.scenery.sideRoadsPerKilometer):
 * narrow lanes that leave the country roads at T-junctions, now and then
 * crossing them at a crossroads, and wind off across the land to a
 * farmstead, past a hamlet, or on to another road, closing a loop; the
 * longer ones have lanes of their own. Fields line them and the villages'
 * roads (layFarmland). It all grows from the map's seed, clear of whatever
 * the map holds (CountryPlan), so the same map always grows the same lanes:
 * a map's author lays out the towns and the roads between them, and the
 * country in between fills itself in.
 */

/** A lane is this wide, meters: room for a car each way, or for a truck. */
export const LANE_WIDTH_METERS = 5.5;

/** Lanes leave the map's country roads no nearer their ends (in the towns) than this, meters… */
const MAP_ROAD_END_CLEARANCE_METERS = 260;
/** …a village's road no nearer its ends (its junctions) than this, and a lane no nearer than this (its farm, the road it left). */
const NEW_ROAD_END_CLEARANCE_METERS = 150;
const LANE_END_CLEARANCE_METERS = 100;
/** Where a lane would leave its road, it looks this far either way along it for room, meters. */
const BRANCH_NUDGES_METERS = [0, 36, -36, 72, -72] as const;
/** A lane leaves its road square to it for this long, meters… */
const LEAVE_METERS = [42, 56] as const;
/** …then winds on in up to this many steps, as far as the land lets it, each this long… */
const STEPS = [2, 7] as const;
const STEP_METERS = [70, 115] as const;
/** …each turning up to this much from the last (radians), and never further than this from the way it set out. */
const MAX_TURN = 0.5;
const MAX_WANDER = 1.3;
/** Where its way on is blocked, a lane tries turning this much further off it (radians). */
const DETOURS = [0.4, -0.4, 0.8, -0.8] as const;
/** At this share of the places a lane leaves its road, another leaves it the other way: a crossroads. */
const CROSSROADS_SHARE = 0.3;
/**
 * This share of the lanes head for the nearest road ahead within this far,
 * and join one that comes this near their tip (closing a loop), meeting it
 * square from this far out; a lane turns at most this much (radians) on its
 * way in, then this much onto the square.
 */
const JOIN_SHARE = 0.45;
const JOIN_LOOK_METERS = 900;
const JOIN_REACH_METERS = 280;
const APPROACH_METERS = 45;
const MAX_JOIN_TURN = 1;
const MAX_SQUARE_TURN = 1.1;
/** How far along a road the lane joining it tries either side of the nearest place, in samples. */
const JOIN_NUDGES = [0, 10, -10, 20, -20] as const;
/** A lane joins the road it left only this far along it from where it left, meters. */
const LOOP_MIN_ALONG_METERS = 700;
/** Lanes shorter than this are left out, meters. */
const MIN_LANE_METERS = 120;
/** This share of the lanes at least this long have a lane of their own, leaving them this share of their way along. */
const SIDE_LANE_SHARE = 0.4;
const SIDE_LANE_MIN_METERS = 400;
const SIDE_LANE_ALONG = [0.35, 0.65] as const;

/** A kind of building's sizes: its length (along the lane), width and height, meters. */
interface BuildingSize {
  readonly length: readonly [number, number];
  readonly width: readonly [number, number];
  readonly height: readonly [number, number];
}
const FARMHOUSE: BuildingSize = { length: [11, 14], width: [8, 10], height: [6, 7.5] };
const BARN: BuildingSize = { length: [20, 28], width: [11, 15], height: [7, 9.5] };
const SILO: BuildingSize = { length: [6, 7], width: [6, 7], height: [13, 17] };
const SHED: BuildingSize = { length: [9, 12], width: [6, 8], height: [4, 5] };
const HOUSE: BuildingSize = { length: [9, 12], width: [8, 10], height: [5, 7] };
/** This share of the lanes that end end at a farmstead; it has a silo and a shed these shares of the time. */
const FARM_SHARE = 0.85;
const SILO_SHARE = 0.5;
const SHED_SHARE = 0.5;
/**
 * Where a farmstead's buildings stand round the lane's end: this far along
 * past it (meters, back along the lane where negative) and this far across
 * (right of it where positive).
 */
const FARM_SPOTS: readonly { readonly along: readonly [number, number]; readonly across: readonly [number, number] }[] = [
  { along: [-10, 14], across: [19, 30] },
  { along: [-10, 14], across: [-30, -19] },
  { along: [26, 42], across: [-14, 14] },
];
/** Tries at placing each building. */
const BUILDING_TRIES = 8;
/** This share of the lanes at least this long pass a hamlet: this many houses… */
const HAMLET_SHARE = 0.3;
const HAMLET_MIN_METERS = 260;
const HAMLET_HOUSES = [3, 7] as const;
/** …this far apart along the lane, set back this far from its edge, meters, from this far along it. */
const HOUSE_SPACING_METERS = [22, 34] as const;
const HOUSE_SETBACK_METERS = [8, 11] as const;
const HAMLET_START_METERS = 80;
/** Fields line the new roads in stretches this long, this far apart, from this far along, meters… */
const FIELD_LENGTH_METERS = [110, 170] as const;
const FIELD_GAP_METERS = [12, 40] as const;
const FIELD_START_METERS = [20, 45] as const;
/** …on each side this share of the time, this far back from its edge and this deep. */
const FIELD_SHARE = 0.6;
const FIELD_SETBACK_METERS = [10, 13] as const;
const FIELD_DEPTH_METERS = [70, 120] as const;

/**
 * Grows side roads off `plan`'s country roads (the map's and the
 * villages'), about `perKilometer` lanes per kilometre of them, from
 * `seed`: lanes, with farmsteads at their ends and hamlets along them.
 */
export function growSideRoads(plan: CountryPlan, seed: number, perKilometer: number): void {
  if (perKilometer > 0) {
    new SideRoadGrowth(plan).grow(seed, perKilometer);
  }
}

/** Fields along `plan`'s new country roads and lanes, where they have room, from `seed`. */
export function layFarmland(plan: CountryPlan, seed: number): void {
  const random = new SeededRandom(seed);
  for (let index = plan.mapRoadCount; index < plan.roads.length; index++) {
    const own = new SeededRandom(random.int(0, 0x7fffffff));
    const road = plan.roads[index]!;
    if (road.kind === 'rural' || road.kind === 'lane') {
      layFields(plan, road, own);
    }
  }
}

/** A lane that has grown: its control points, and whether its far end joins a road too (else it ends in a turning circle). */
interface GrownLane {
  readonly points: readonly Point2[];
  readonly joined: boolean;
}

interface Lane {
  readonly path: RoadPath;
  readonly joined: boolean;
}

class SideRoadGrowth {
  private readonly lanes: Lane[] = [];
  private readonly joinableRoads: [RoadPath, number][] = [];
  private joinableUpTo = 0;

  constructor(private readonly plan: CountryPlan) {}

  grow(seed: number, perKilometer: number): void {
    const random = new SeededRandom(seed);
    const spacing = 1000 / perKilometer;
    const roads = this.plan.roads.slice();
    roads.forEach((road, roadIndex) => {
      if (road.kind === 'rural' && !road.closed) {
        this.branchAlong(road, roadIndex, spacing, random);
      }
    });
    // The longer lanes grown so far have lanes of their own.
    const firstLanes = this.lanes.slice();
    for (const lane of firstLanes) {
      const own = new SeededRandom(random.int(0, 0x7fffffff));
      const path = lane.path;
      if (path.lengthMeters >= SIDE_LANE_MIN_METERS && own.next() < SIDE_LANE_SHARE) {
        const along = own.range(SIDE_LANE_ALONG[0], SIDE_LANE_ALONG[1]) * path.lengthMeters;
        this.tryBranch(path, this.plan.roads.indexOf(path), sampleAt(path, along), own, false);
      }
    }
    for (const lane of this.lanes) {
      const own = new SeededRandom(random.int(0, 0x7fffffff));
      if (!lane.joined && own.next() < FARM_SHARE) {
        this.buildFarmstead(lane.path, own);
      }
      if (lane.path.lengthMeters >= HAMLET_MIN_METERS && own.next() < HAMLET_SHARE) {
        this.buildHamlet(lane, own);
      }
    }
  }

  /** Tries lanes off `road` about every `spacing` meters, clear of its ends. */
  private branchAlong(road: RoadPath, roadIndex: number, spacing: number, random: SeededRandom): void {
    const clearance = this.endClearance(roadIndex);
    const last = road.lengthMeters - clearance;
    for (let along = clearance + random.range(0, spacing); along <= last; along += spacing * random.range(0.7, 1.3)) {
      // Each place its own numbers, so a lane that does not grow leaves the others as they were.
      const own = new SeededRandom(random.int(0, 0x7fffffff));
      for (const nudge of BRANCH_NUDGES_METERS) {
        const at = along + nudge;
        if (at >= clearance && at <= last && this.tryBranch(road, roadIndex, sampleAt(road, at), own, true)) {
          break;
        }
      }
    }
  }

  /** How far from its ends road `roadIndex` may be joined, meters. */
  private endClearance(roadIndex: number): number {
    if (roadIndex < this.plan.mapRoadCount) {
      return MAP_ROAD_END_CLEARANCE_METERS;
    }
    return this.plan.roads[roadIndex]!.kind === 'lane' ? LANE_END_CLEARANCE_METERS : NEW_ROAD_END_CLEARANCE_METERS;
  }

  /**
   * Tries a lane off `parent` (road `parentIndex`) at its sample `sample`,
   * to one side or, where `crossroads` allows and it turns out so, both.
   * Returns whether any grew.
   */
  private tryBranch(parent: RoadPath, parentIndex: number, sample: number, random: SeededRandom, crossroads: boolean): boolean {
    const x = parent.x(sample);
    const z = parent.z(sample);
    if (!this.plan.canJunction(x, z, parentIndex)) {
      return false;
    }
    const [tangentX, tangentZ] = tangentAt(parent, sample);
    const firstSide = random.sign();
    const bothSides = crossroads && random.next() < CROSSROADS_SHARE;
    const grown: GrownLane[] = [];
    for (const side of [firstSide, -firstSide]) {
      if (grown.length > 0 && !bothSides) {
        break;
      }
      // Right of the road's direction is (-tangentZ, tangentX).
      const lane = this.growLane(x, z, -tangentZ * side, tangentX * side, parentIndex, sample, random.next() < JOIN_SHARE, random);
      if (lane !== null) {
        grown.push(lane);
      }
    }
    if (grown.length === 2 && !keepApart(grown[0]!, grown[1]!, x, z)) {
      grown.pop();
    }
    for (const lane of grown) {
      this.accept(lane);
    }
    return grown.length > 0;
  }

  /**
   * Grows a lane from (x0, z0) on road `parentIndex` (its sample
   * `branchSample`), leaving it along (nx, nz); one that `wantsToJoin`
   * heads for another road and joins it where it can. Null where it cannot
   * grow long enough.
   */
  private growLane(
    x0: number,
    z0: number,
    nx: number,
    nz: number,
    parentIndex: number,
    branchSample: number,
    wantsToJoin: boolean,
    random: SeededRandom,
  ): GrownLane | null {
    const plan = this.plan;
    const points: Point2[] = [[x0, z0]];
    const leave = random.range(LEAVE_METERS[0], LEAVE_METERS[1]);
    let x = x0 + nx * leave;
    let z = z0 + nz * leave;
    if (!plan.isClearRun(x0, z0, x, z, x0, z0)) {
      return null;
    }
    points.push([x, z]);
    const setOut = Math.atan2(nx, nz);
    let heading = setOut;
    let join: readonly Point2[] | null = null;
    const steps = random.int(STEPS[0], STEPS[1]);
    for (let step = 0; step <= steps; step++) {
      if (wantsToJoin) {
        join = this.findJoin(x, z, heading, parentIndex, branchSample, x0, z0);
        if (join !== null) {
          break;
        }
      }
      if (step === steps) {
        break;
      }
      const length = random.range(STEP_METERS[0], STEP_METERS[1]);
      let turn = random.range(-MAX_TURN, MAX_TURN);
      if (wantsToJoin) {
        const bearing = this.bearingToJoin(x, z, heading, parentIndex, branchSample);
        if (bearing !== null) {
          turn = clamp(angleFrom(heading, bearing), -MAX_TURN, MAX_TURN) * 0.75 + turn * 0.25;
        }
      }
      let placed = false;
      for (let k = -1; k < DETOURS.length && !placed; k++) {
        const wander = clamp(angleFrom(setOut, heading + turn + (k < 0 ? 0 : DETOURS[k]!)), -MAX_WANDER, MAX_WANDER);
        const nextHeading = setOut + wander;
        const nextX = x + Math.sin(nextHeading) * length;
        const nextZ = z + Math.cos(nextHeading) * length;
        if (plan.isClearRun(x, z, nextX, nextZ, x0, z0)) {
          points.push([nextX, nextZ]);
          x = nextX;
          z = nextZ;
          heading = nextHeading;
          placed = true;
        }
      }
      if (!placed) {
        break;
      }
    }
    if (join !== null) {
      points.push(...join);
    }
    return this.settle(points, join !== null, x0, z0);
  }

  /**
   * The lane through `points` as its curve runs, cut short before the first
   * stretch that is not clear (then ending there, joining nothing). Null
   * when too little is left.
   */
  private settle(points: readonly Point2[], joined: boolean, x0: number, z0: number): GrownLane | null {
    let count = points.length;
    let joins = joined;
    while (count >= 3 || (joins && count >= 2)) {
      const kept = points.slice(0, count);
      const path = lanePath('lane', kept);
      const end = kept[count - 1]!;
      const blocked = this.plan.firstBlockedSample(path, x0, z0, joins ? end[0] : Number.NaN, joins ? end[1] : Number.NaN);
      if (blocked < 0) {
        return path.lengthMeters >= MIN_LANE_METERS ? { points: kept, joined: joins } : null;
      }
      count = controlPointsBefore(path, kept, blocked);
      joins = false;
    }
    return null;
  }

  /** The roads a lane may join: the country roads and the lanes, with their indices (kept up with the plan's roads). */
  private joinable(): readonly [RoadPath, number][] {
    const roads = this.plan.roads;
    for (let index = this.joinableUpTo; index < roads.length; index++) {
      const road = roads[index]!;
      if ((road.kind === 'rural' && !road.closed) || road.kind === 'lane') {
        this.joinableRoads.push([road, index]);
      }
    }
    this.joinableUpTo = roads.length;
    return this.joinableRoads;
  }

  /** Whether sample `sample` of road `roadIndex` lies far enough from its ends, and from where the lane left it, to join it there. */
  private mayJoinAt(road: RoadPath, roadIndex: number, sample: number, parentIndex: number, branchSample: number): boolean {
    const along = road.distances[sample]!;
    const clearance = this.endClearance(roadIndex);
    if (along < clearance || road.lengthMeters - along < clearance) {
      return false;
    }
    return roadIndex !== parentIndex || Math.abs(along - road.distances[branchSample]!) >= LOOP_MIN_ALONG_METERS;
  }

  /** The bearing (radians) from (x, z) to the nearest road ahead that the lane could join, within JOIN_LOOK_METERS, or null. */
  private bearingToJoin(x: number, z: number, heading: number, parentIndex: number, branchSample: number): number | null {
    let nearest = JOIN_LOOK_METERS;
    let bearing: number | null = null;
    for (const [road, roadIndex] of this.joinable()) {
      const sample = road.nearestSampleIndex(x, z);
      const distance = Math.hypot(road.x(sample) - x, road.z(sample) - z);
      if (distance >= nearest || !this.mayJoinAt(road, roadIndex, sample, parentIndex, branchSample)) {
        continue;
      }
      const toward = Math.atan2(road.x(sample) - x, road.z(sample) - z);
      if (Math.abs(angleFrom(heading, toward)) < Math.PI / 2) {
        nearest = distance;
        bearing = toward;
      }
    }
    return bearing;
  }

  /** The points by which the lane at (x, z), heading `heading`, joins the nearest road it may within JOIN_REACH_METERS, or null. */
  private findJoin(
    x: number,
    z: number,
    heading: number,
    parentIndex: number,
    branchSample: number,
    x0: number,
    z0: number,
  ): readonly Point2[] | null {
    const candidates: [RoadPath, number, number, number][] = [];
    for (const [road, roadIndex] of this.joinable()) {
      const sample = road.nearestSampleIndex(x, z);
      const distance = Math.hypot(road.x(sample) - x, road.z(sample) - z);
      if (distance < JOIN_REACH_METERS) {
        candidates.push([road, roadIndex, sample, distance]);
      }
    }
    candidates.sort((a, b) => a[3] - b[3]);
    for (const [road, roadIndex, nearest] of candidates) {
      for (const nudge of JOIN_NUDGES) {
        const sample = nearest + nudge;
        if (sample < 0 || sample >= road.pointCount || !this.mayJoinAt(road, roadIndex, sample, parentIndex, branchSample)) {
          continue;
        }
        const plan = this.planJoin(x, z, heading, road, roadIndex, sample, x0, z0);
        if (plan !== null) {
          return plan;
        }
      }
    }
    return null;
  }

  /** The points by which the lane at (x, z), heading `heading`, joins `road` (index `roadIndex`) at its sample `sample`, square to it; or null. */
  private planJoin(
    x: number,
    z: number,
    heading: number,
    road: RoadPath,
    roadIndex: number,
    sample: number,
    x0: number,
    z0: number,
  ): readonly Point2[] | null {
    const plan = this.plan;
    const jx = road.x(sample);
    const jz = road.z(sample);
    if (!plan.canJunction(jx, jz, roadIndex)) {
      return null;
    }
    const [tangentX, tangentZ] = tangentAt(road, sample);
    // Square to the road, on the lane's side of it.
    let nx = -tangentZ;
    let nz = tangentX;
    if (nx * (x - jx) + nz * (z - jz) < 0) {
      nx = -nx;
      nz = -nz;
    }
    const ax = jx + nx * APPROACH_METERS;
    const az = jz + nz * APPROACH_METERS;
    const run = Math.atan2(ax - x, az - z);
    if (
      Math.abs(angleFrom(heading, run)) > MAX_JOIN_TURN ||
      Math.abs(angleFrom(run, Math.atan2(-nx, -nz))) > MAX_SQUARE_TURN ||
      !plan.isClearRun(x, z, ax, az, x0, z0, jx, jz) ||
      !plan.isClearRun(ax, az, jx, jz, x0, z0, jx, jz)
    ) {
      return null;
    }
    return [
      [ax, az],
      [jx, jz],
    ];
  }

  private accept(grown: GrownLane): void {
    const path = lanePath(`lane_${this.lanes.length + 1}`, grown.points);
    this.plan.addRoad(path);
    this.lanes.push({ path, joined: grown.joined });
    if (!grown.joined) {
      this.plan.addTurningCircle(path, false);
    }
  }

  /** A farmhouse round the end of `path` (a dead end), with a barn, maybe a silo and a shed; nothing where the house has no room. */
  private buildFarmstead(path: RoadPath, random: SeededRandom): void {
    const [ux, uz] = endDirection(path);
    const end = path.pointCount - 1;
    const ex = path.x(end);
    const ez = path.z(end);
    const sizes = [FARMHOUSE, BARN];
    if (random.next() < SILO_SHARE) {
      sizes.push(SILO);
    }
    if (random.next() < SHED_SHARE) {
      sizes.push(SHED);
    }
    for (const size of sizes) {
      let placed = false;
      for (let attempt = 0; attempt < BUILDING_TRIES && !placed; attempt++) {
        const spot = FARM_SPOTS[random.int(0, FARM_SPOTS.length - 1)]!;
        const along = random.range(spot.along[0], spot.along[1]);
        const across = random.range(spot.across[0], spot.across[1]);
        // Right of the lane's direction is (-uz, ux).
        placed = this.tryBuilding(ex + ux * along - uz * across, ez + uz * along + ux * across, ux, uz, size, random);
      }
      if (!placed && size === FARMHOUSE) {
        return;
      }
    }
  }

  /** A row of houses either side of a stretch of `lane`. */
  private buildHamlet(lane: Lane, random: SeededRandom): void {
    const path = lane.path;
    const stop = path.lengthMeters - (lane.joined ? JUNCTION_REACH_METERS + 20 : 30);
    const wanted = random.int(HAMLET_HOUSES[0], HAMLET_HOUSES[1]);
    const point = createRoadPoint();
    let side = random.sign();
    let houses = 0;
    for (
      let along = random.range(HAMLET_START_METERS, Math.max(HAMLET_START_METERS, stop - wanted * HOUSE_SPACING_METERS[1]));
      along < stop && houses < wanted;
      along += random.range(HOUSE_SPACING_METERS[0], HOUSE_SPACING_METERS[1])
    ) {
      const { x, z, directionX: ux, directionZ: uz } = path.pointAt(along, point);
      const length = random.range(HOUSE.length[0], HOUSE.length[1]);
      const width = random.range(HOUSE.width[0], HOUSE.width[1]);
      const [sizeX, sizeZ] = Math.abs(ux) >= Math.abs(uz) ? [length, width] : [width, length];
      const nx = -uz * side;
      const nz = ux * side;
      const halfAcross = (Math.abs(nx) * sizeX + Math.abs(nz) * sizeZ) / 2;
      const offset = LANE_WIDTH_METERS / 2 + random.range(HOUSE_SETBACK_METERS[0], HOUSE_SETBACK_METERS[1]) + halfAcross;
      if (this.plan.tryBuilding(x + nx * offset, z + nz * offset, sizeX, sizeZ, random.range(HOUSE.height[0], HOUSE.height[1]))) {
        houses++;
      }
      side = random.next() < 0.7 ? -side : side;
    }
  }

  /** A building of `size` with its middle at (x, z), its length along (ux, uz) as near as walls square to the map allow. */
  private tryBuilding(x: number, z: number, ux: number, uz: number, size: BuildingSize, random: SeededRandom): boolean {
    const length = random.range(size.length[0], size.length[1]);
    const width = random.range(size.width[0], size.width[1]);
    const height = random.range(size.height[0], size.height[1]);
    const [sizeX, sizeZ] = Math.abs(ux) >= Math.abs(uz) ? [length, width] : [width, length];
    return this.plan.tryBuilding(x, z, sizeX, sizeZ, height);
  }
}

/** Fields in stretches along both sides of `road`, where they have room. */
function layFields(plan: CountryPlan, road: RoadPath, random: SeededRandom): void {
  const stop = road.lengthMeters - JUNCTION_REACH_METERS;
  let from = random.range(FIELD_START_METERS[0], FIELD_START_METERS[1]);
  while (from + FIELD_LENGTH_METERS[0] <= stop) {
    const length = Math.min(random.range(FIELD_LENGTH_METERS[0], FIELD_LENGTH_METERS[1]), stop - from);
    const sides: readonly RoadSide[] = random.next() < 0.5 ? ['left', 'right'] : ['right', 'left'];
    for (const side of sides) {
      const wanted = random.next() < FIELD_SHARE;
      const field: FieldDefinition = {
        roadId: road.id,
        fromMeters: from,
        lengthMeters: length,
        side,
        setbackMeters: random.range(FIELD_SETBACK_METERS[0], FIELD_SETBACK_METERS[1]),
        depthMeters: random.range(FIELD_DEPTH_METERS[0], FIELD_DEPTH_METERS[1]),
        crop: FIELD_CROPS[random.int(0, FIELD_CROPS.length - 1)]!,
      };
      if (wanted) {
        plan.tryField(field, fieldArea(road, field));
      }
    }
    from += length + random.range(FIELD_GAP_METERS[0], FIELD_GAP_METERS[1]);
  }
}

/** A lane through `points`, as a road. */
function lanePath(id: string, points: readonly Point2[]): RoadPath {
  return new RoadPath({ id, kind: 'lane', widthMeters: LANE_WIDTH_METERS, closed: false, controlPoints: points });
}

/** Whether two lanes leaving the same place (x, z) on either side of their road keep apart further out. */
function keepApart(a: GrownLane, b: GrownLane, x: number, z: number): boolean {
  const pathA = lanePath('a', a.points);
  const pathB = lanePath('b', b.points);
  const far = (path: RoadPath, i: number): boolean => Math.hypot(path.x(i) - x, path.z(i) - z) >= JUNCTION_REACH_METERS;
  for (let i = 0; i < pathA.pointCount; i++) {
    if (!far(pathA, i)) {
      continue;
    }
    for (let k = 0; k < pathB.pointCount; k++) {
      if (far(pathB, k) && Math.hypot(pathA.x(i) - pathB.x(k), pathA.z(i) - pathB.z(k)) < ROAD_CLEARANCE_METERS + LANE_WIDTH_METERS) {
        return false;
      }
    }
  }
  return true;
}

/** The sample of `road` nearest `along` meters along it. */
export function sampleAt(road: RoadPath, along: number): number {
  let low = 0;
  let high = road.pointCount - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (road.distances[middle]! <= along) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return along - road.distances[low]! <= road.distances[high]! - along ? low : high;
}

/** The road's direction at sample `i` (a unit vector, x and z), from its neighbours. */
export function tangentAt(road: RoadPath, i: number): [number, number] {
  const before = road.stepIndex(i, -1);
  const after = road.stepIndex(i, 1);
  const dx = road.x(after) - road.x(before);
  const dz = road.z(after) - road.z(before);
  const length = Math.hypot(dx, dz) || 1;
  return [dx / length, dz / length];
}

/** The way a road runs into its last sample (a unit vector). */
function endDirection(road: RoadPath): [number, number] {
  const end = road.pointCount - 1;
  const dx = road.x(end) - road.x(end - 1);
  const dz = road.z(end) - road.z(end - 1);
  const length = Math.hypot(dx, dz) || 1;
  return [dx / length, dz / length];
}

/**
 * How many of the control points of the road through `points` come before
 * its sample `index` (at least the first): every control point is one of
 * the samples, exactly.
 */
export function controlPointsBefore(path: RoadPath, points: readonly Point2[], index: number): number {
  let count = 1;
  for (let i = 1; i < index; i++) {
    const next = points[count];
    if (next !== undefined && path.x(i) === next[0] && path.z(i) === next[1]) {
      count++;
    }
  }
  return count;
}

/** The turn from heading `from` to heading `to`, radians, -π..π. */
export function angleFrom(from: number, to: number): number {
  const turn = (to - from) % (Math.PI * 2);
  return turn > Math.PI ? turn - Math.PI * 2 : turn < -Math.PI ? turn + Math.PI * 2 : turn;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
