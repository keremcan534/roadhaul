import type { DepotDefinition } from '../../data/definitions/MapDefinition';
import type { BuildingObstacle } from './DrivingWorld';
import type { RoadPath } from './RoadPath';

/** A building that catches fire is at least this tall: a town's house or block, not a shed. */
export const BURNING_BUILDING_MIN_HEIGHT_METERS = 7;
/** Something counts as ahead of the truck within this angle either side of its heading (its cosine). */
const AHEAD_COSINE = 0.3;

/** A place on a road: a sample of its centreline, the road's direction there (a unit vector), and its half width. */
export interface RoadSpot {
  x: number;
  z: number;
  directionX: number;
  directionZ: number;
  halfWidthMeters: number;
}

export function createRoadSpot(): RoadSpot {
  return { x: 0, z: 0, directionX: 0, directionZ: 1, halfWidthMeters: 0 };
}

/** The fire is in one of this many buildings nearest the truck: near enough to be seen. */
const NEAREST_BUILDINGS = 6;

/**
 * A town's building between `near` and `far` meters of (x, z) that could
 * catch fire (a block at least BURNING_BUILDING_MIN_HEIGHT_METERS tall, in a
 * town or village, not the country's farms): one of the few nearest ahead
 * of `heading` if there are any, else of those around; `roll` (uniform in
 * [0, 1)) picks which. Null when none is.
 */
export function pickBurningBuilding(
  buildings: readonly BuildingObstacle[],
  x: number,
  z: number,
  heading: number,
  near: number,
  far: number,
  roll: number,
): BuildingObstacle | null {
  const ahead: BuildingObstacle[] = [];
  const around: BuildingObstacle[] = [];
  const forwardX = Math.sin(heading);
  const forwardZ = Math.cos(heading);
  for (const building of buildings) {
    if (building.country === true || building.form !== undefined || building.heightMeters < BURNING_BUILDING_MIN_HEIGHT_METERS) {
      continue;
    }
    const dx = (building.minX + building.maxX) / 2 - x;
    const dz = (building.minZ + building.maxZ) / 2 - z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance < near || distance > far) {
      continue;
    }
    around.push(building);
    if (dx * forwardX + dz * forwardZ > AHEAD_COSINE * distance) {
      ahead.push(building);
    }
  }
  const list = ahead.length > 0 ? ahead : around;
  const distance = (building: BuildingObstacle): number =>
    ((building.minX + building.maxX) / 2 - x) ** 2 + ((building.minZ + building.maxZ) / 2 - z) ** 2;
  list.sort((a, b) => distance(a) - distance(b));
  return pickOne(list.slice(0, NEAREST_BUILDINGS), roll);
}

/**
 * The sample of `roads` nearest (x, z), written into `out`: true when there
 * is any road. Lanes (farm tracks) are left out unless `lanes`.
 */
export function nearestRoadSpot(roads: readonly RoadPath[], x: number, z: number, out: RoadSpot, lanes = false): boolean {
  let best = Number.POSITIVE_INFINITY;
  let bestRoad: RoadPath | null = null;
  let bestIndex = 0;
  for (const road of roads) {
    if (!lanes && road.kind === 'lane') {
      continue;
    }
    for (let i = 0; i < road.pointCount; i++) {
      const dx = road.x(i) - x;
      const dz = road.z(i) - z;
      const distance = dx * dx + dz * dz;
      if (distance < best) {
        best = distance;
        bestRoad = road;
        bestIndex = i;
      }
    }
  }
  if (bestRoad === null) {
    return false;
  }
  writeSpot(bestRoad, bestIndex, out);
  return true;
}

/**
 * A sample of a road (not a farm lane) between `near` and `far` meters of
 * (x, z), one ahead of `heading` if there is any (`heading` NaN: any way),
 * written into `out`; `roll` (uniform in [0, 1)) picks which. False when
 * none is.
 */
export function pickRoadSpot(
  roads: readonly RoadPath[],
  x: number,
  z: number,
  heading: number,
  near: number,
  far: number,
  roll: number,
  out: RoadSpot,
): boolean {
  const ahead: [RoadPath, number][] = [];
  const around: [RoadPath, number][] = [];
  const anyWay = Number.isNaN(heading);
  const forwardX = anyWay ? 0 : Math.sin(heading);
  const forwardZ = anyWay ? 0 : Math.cos(heading);
  for (const road of roads) {
    if (road.kind === 'lane') {
      continue;
    }
    // Every few samples is plenty to choose from.
    for (let i = 0; i < road.pointCount; i += 4) {
      const dx = road.x(i) - x;
      const dz = road.z(i) - z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      if (distance < near || distance > far) {
        continue;
      }
      around.push([road, i]);
      if (anyWay || dx * forwardX + dz * forwardZ > AHEAD_COSINE * distance) {
        ahead.push([road, i]);
      }
    }
  }
  const picked = pickOne(ahead.length > 0 ? ahead : around, roll);
  if (picked === null) {
    return false;
  }
  writeSpot(picked[0], picked[1], out);
  return true;
}

/** The city of the depot nearest (x, z), or null on a map without depots. */
export function nearestCityId(depots: readonly DepotDefinition[], x: number, z: number): string | null {
  let best = Number.POSITIVE_INFINITY;
  let cityId: string | null = null;
  for (const depot of depots) {
    const dx = depot.yard.x - x;
    const dz = depot.yard.z - z;
    const distance = dx * dx + dz * dz;
    if (distance < best) {
      best = distance;
      cityId = depot.cityId;
    }
  }
  return cityId;
}

function writeSpot(road: RoadPath, index: number, out: RoadSpot): void {
  const count = road.pointCount;
  const previous = road.closed ? (index - 1 + count) % count : Math.max(0, index - 1);
  const next = road.closed ? (index + 1) % count : Math.min(count - 1, index + 1);
  const tx = road.x(next) - road.x(previous);
  const tz = road.z(next) - road.z(previous);
  const length = Math.sqrt(tx * tx + tz * tz) || 1;
  out.x = road.x(index);
  out.z = road.z(index);
  out.directionX = tx / length;
  out.directionZ = tz / length;
  out.halfWidthMeters = road.widthMeters / 2;
}

function pickOne<T>(list: readonly T[], roll: number): T | null {
  return list.length === 0 ? null : list[Math.min(list.length - 1, Math.floor(Math.max(0, roll) * list.length))]!;
}
