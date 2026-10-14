import { SeededRandom } from '../../core/random/SeededRandom';
import {
  rectangleContains,
  rectangleCorners,
  type BuildingDefinition,
  type RectangleDefinition,
} from '../../data/definitions/MapDefinition';
import type { CountryPlan } from './countryPlan';

/** A shipping container (20 feet): its length, width and height, meters. */
export const CONTAINER_METERS = { length: 6.06, width: 2.44, height: 2.59 } as const;
/** The gap between containers side by side or end to end in a stack, meters. */
export const CONTAINER_GAP_METERS = 0.12;
/** A stack: two containers end to end, two or three side by side, two or three high. */
const STACK_ALONG = 2;
const STACK_ACROSS = [2, 3] as const;
const STACK_TIERS = [2, 3] as const;
/**
 * Stacks stand this far out from a yard's edge, meters (past the 12 m the country's buildings keep from a yard's
 * corners, room for a truck turning in), and no more than this many round a yard.
 */
const YARD_OFFSETS_METERS = [13, 17] as const;
const STACKS_PER_YARD = 2;
/** A stack keeps this far from any yard or lot, and from the map's own buildings, meters. */
const YARD_CLEARANCE_METERS = 3;
const BUILDING_CLEARANCE_METERS = 3;

/**
 * Stacks of shipping containers round the depots' yards (`depotYards`), where the country has room for them: the
 * country plan's clearances from the roads, turning circles, fields, parks and its buildings, and here from every
 * yard and lot (`yards`) and the map's own buildings. A yard's road side has no room (its edge lies on the road), so
 * they stand along its far side and at its ends. Each is a building of the form 'containers', its box the stack's.
 * Laid after the country has grown, from its own `seed`: what grew before is the same. Yards turned other than by a
 * quarter turn get none (the buildings' boxes stand square to the map).
 */
export function stackContainers(
  plan: CountryPlan,
  depotYards: readonly RectangleDefinition[],
  yards: readonly RectangleDefinition[],
  mapBuildings: readonly BuildingDefinition[],
  seed: number,
): void {
  const random = new SeededRandom(seed);
  for (const yard of depotYards) {
    const quarter = Math.round(yard.headingDegrees / 90);
    if (Math.abs(yard.headingDegrees - quarter * 90) > 1e-6) {
      continue;
    }
    // The yard's length runs along X when turned a quarter (or three), along Z otherwise.
    const lengthAlongX = quarter % 2 !== 0;
    const candidates = yardSpots(yard, lengthAlongX);
    shuffle(candidates, random);
    let stacked = 0;
    for (const spot of candidates) {
      if (stacked >= STACKS_PER_YARD) {
        break;
      }
      const across = STACK_ACROSS[random.int(0, STACK_ACROSS.length - 1)]!;
      const tiers = STACK_TIERS[random.int(0, STACK_TIERS.length - 1)]!;
      // The containers lie along the yard's length.
      const length = STACK_ALONG * CONTAINER_METERS.length + (STACK_ALONG - 1) * CONTAINER_GAP_METERS;
      const width = across * CONTAINER_METERS.width + (across - 1) * CONTAINER_GAP_METERS;
      const sizeX = lengthAlongX ? length : width;
      const sizeZ = lengthAlongX ? width : length;
      // Out from the yard's edge by the offset and the stack's own half.
      const x = spot.x + spot.outX * (sizeX / 2);
      const z = spot.z + spot.outZ * (sizeZ / 2);
      if (
        clearOfYards(x, z, sizeX, sizeZ, yards) &&
        clearOfBuildings(x, z, sizeX, sizeZ, mapBuildings) &&
        plan.tryBuilding(x, z, sizeX, sizeZ, tiers * CONTAINER_METERS.height, 'containers')
      ) {
        stacked++;
      }
    }
  }
}

/** Where a stack may stand round a yard: its edge's point, and the way out from the yard (a unit along X or Z). */
interface YardSpot {
  readonly x: number;
  readonly z: number;
  readonly outX: number;
  readonly outZ: number;
}

/** Spots beside each long side (a third of the way from each end, and the middle) and off each end of `yard`. */
function yardSpots(yard: RectangleDefinition, lengthAlongX: boolean): YardSpot[] {
  const halfX = (lengthAlongX ? yard.lengthMeters : yard.widthMeters) / 2;
  const halfZ = (lengthAlongX ? yard.widthMeters : yard.lengthMeters) / 2;
  const spots: YardSpot[] = [];
  for (const offset of YARD_OFFSETS_METERS) {
    for (const side of [-1, 1]) {
      // Off the sides along X: beyond halfX; off the sides along Z: beyond halfZ.
      for (const share of [-1 / 3, 0, 1 / 3]) {
        spots.push({ x: yard.x + share * 2 * halfX, z: yard.z + side * (halfZ + offset), outX: 0, outZ: side });
        spots.push({ x: yard.x + side * (halfX + offset), z: yard.z + share * 2 * halfZ, outX: side, outZ: 0 });
      }
    }
  }
  return spots;
}

/** Whether a box (x, z, sizeX × sizeZ) keeps its clearance from every yard and lot: none of its corners or its middle in one. */
function clearOfYards(x: number, z: number, sizeX: number, sizeZ: number, yards: readonly RectangleDefinition[]): boolean {
  const box: RectangleDefinition = { x, z, headingDegrees: 0, lengthMeters: sizeZ, widthMeters: sizeX };
  return yards.every(
    (yard) =>
      !rectangleCorners(box).some(([cx, cz]) => rectangleContains(yard, cx, cz, YARD_CLEARANCE_METERS)) &&
      !rectangleContains(yard, x, z, YARD_CLEARANCE_METERS) &&
      !rectangleCorners(yard).some(([cx, cz]) => rectangleContains(box, cx, cz, YARD_CLEARANCE_METERS)),
  );
}

/** Whether a box (x, z, sizeX × sizeZ) keeps its clearance from the map's own buildings. */
function clearOfBuildings(x: number, z: number, sizeX: number, sizeZ: number, buildings: readonly BuildingDefinition[]): boolean {
  return buildings.every(
    (building) =>
      Math.abs(x - building.x) >= (sizeX + building.widthMeters) / 2 + BUILDING_CLEARANCE_METERS ||
      Math.abs(z - building.z) >= (sizeZ + building.depthMeters) / 2 + BUILDING_CLEARANCE_METERS,
  );
}

/** Fisher–Yates, in place, from `random`. */
function shuffle<T>(items: T[], random: SeededRandom): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = random.int(0, i);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
}
