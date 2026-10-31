import { SeededRandom } from '../../core/random/SeededRandom';
import type { DistrictDefinition, DistrictKind } from '../../data/definitions/MapDefinition';
import type { CountryPlan } from './countryPlan';
import { createRoadPoint } from './RoadPath';

/** How a district's buildings are made: [low, high] ranges, meters unless named otherwise. */
interface DistrictStyle {
  /** Along the street, and back from it. */
  readonly frontage: readonly [number, number];
  readonly depth: readonly [number, number];
  readonly floors: readonly [number, number];
  /** A floor's height, meters. */
  readonly floorMeters: number;
  /** Between neighbours along the street (shoulder to shoulder, or yards between). */
  readonly gap: readonly [number, number];
  /** How near the street's edge the front stands: the pavement and a little more. */
  readonly setback: readonly [number, number];
  /** The share with shops along the ground floor. */
  readonly shops: number;
  /** A few rise far above the rest: this share, this many floors. */
  readonly towers: number;
  readonly towerFloors: readonly [number, number];
  /** The blocks behind the street fronts: buildings this size, tried every `step` meters. */
  readonly back: { readonly size: readonly [number, number]; readonly floors: readonly [number, number]; readonly step: number };
}

const STYLES: Readonly<Record<DistrictKind, DistrictStyle>> = {
  oldTown: {
    frontage: [11, 17],
    depth: [12, 17],
    floors: [3, 5],
    floorMeters: 3.1,
    gap: [0.6, 1.8],
    setback: [3.4, 3.9],
    shops: 0.6,
    towers: 0,
    towerFloors: [0, 0],
    back: { size: [10, 15], floors: [2, 4], step: 40 },
  },
  apartments: {
    frontage: [22, 36],
    depth: [12, 16],
    floors: [5, 8],
    floorMeters: 3,
    gap: [5, 11],
    setback: [4.5, 7],
    shops: 0.25,
    towers: 0.06,
    towerFloors: [10, 13],
    back: { size: [20, 32], floors: [4, 7], step: 56 },
  },
  offices: {
    frontage: [24, 38],
    depth: [18, 26],
    floors: [6, 11],
    floorMeters: 3.6,
    gap: [4, 9],
    setback: [4, 5.5],
    shops: 0.35,
    towers: 0.2,
    towerFloors: [14, 19],
    back: { size: [22, 32], floors: [5, 9], step: 52 },
  },
  harbour: {
    frontage: [30, 52],
    depth: [20, 32],
    floors: [1, 2],
    floorMeters: 5,
    gap: [6, 12],
    setback: [6, 9],
    shops: 0,
    towers: 0,
    towerFloors: [0, 0],
    back: { size: [26, 44], floors: [1, 2], step: 46 },
  },
};

/** A stretch of street counts as running north-south or east-west within this (the cosine of about 4°). */
const SQUARE_TO_THE_MAP = 0.9975;
/** Along a street, a place that takes no building is passed by this far before the next try, meters. */
const SKIP_METERS = 4;
/** The buildings in a block's middle keep this far from any road's edge, meters. */
const BACK_ROAD_CLEARANCE_METERS = 7;
/** A block's buildings keep this far apart, meters (the street fronts: the style's gaps). */
const BACK_GAP_METERS = 5;
/** The height of the ground floor's parapet and the roof's edge over the floors, meters. */
const ROOF_EDGE_METERS = 1.4;

/** How many buildings each district grew. */
export interface GrownDistrict {
  readonly id: string;
  readonly buildings: number;
}

/**
 * Grows the towns' `districts` on `plan`'s land, from `seed`, before the
 * country: in each, its kind's buildings line every map street through it
 * that runs north-south or east-west, on both sides (those standing in the
 * district: a street on its edge, on its side), facing it (a
 * building's box is square to the map), each the next along the street
 * after a gap; then the blocks behind the fronts fill with lower buildings
 * set back from every road. Whatever already stands there (the map's
 * buildings, yards, parks, the sea, a river) keeps its room: a building
 * that does not fit is left out, and the next one tried a little further
 * on. Every building carries its district's kind (its look) and whether it
 * has shops.
 */
export function growDistricts(plan: CountryPlan, districts: readonly DistrictDefinition[], seed: number): GrownDistrict[] {
  const random = new SeededRandom(seed);
  return districts.map((district) => {
    const before = plan.buildings.length;
    const rng = new SeededRandom(random.int(0, 0x7fffffff));
    lineStreets(plan, district, rng);
    fillBlocks(plan, district, rng);
    return { id: district.id, buildings: plan.buildings.length - before };
  });
}

function bounds(district: DistrictDefinition): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const { area } = district;
  return {
    minX: area.x - area.widthMeters / 2,
    maxX: area.x + area.widthMeters / 2,
    minZ: area.z - area.lengthMeters / 2,
    maxZ: area.z + area.lengthMeters / 2,
  };
}

/** A height for `floors` floors of `style`, with a little of its own. */
function heightOf(style: DistrictStyle, floors: number, random: SeededRandom): number {
  return floors * style.floorMeters + ROOF_EDGE_METERS + random.range(-0.3, 0.6);
}

function lineStreets(plan: CountryPlan, district: DistrictDefinition, random: SeededRandom): void {
  const style = STYLES[district.kind];
  const box = bounds(district);
  const inside = (x: number, z: number): boolean => x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;
  const start = createRoadPoint();
  const middle = createRoadPoint();
  const end = createRoadPoint();
  for (let index = 0; index < plan.mapRoadCount; index++) {
    const road = plan.roads[index]!;
    if (road.kind !== 'street' && road.kind !== 'ringRoad' && road.kind !== 'highway') {
      continue;
    }
    for (const side of [1, -1] as const) {
      let along = 0;
      while (along < road.lengthMeters) {
        const frontage = random.range(style.frontage[0], style.frontage[1]);
        road.pointAt(along, start);
        road.pointAt(along + frontage / 2, middle);
        road.pointAt(along + frontage, end);
        const square = (point: typeof start): boolean =>
          Math.abs(point.directionX) > SQUARE_TO_THE_MAP || Math.abs(point.directionZ) > SQUARE_TO_THE_MAP;
        if (!square(start) || !square(end) || along + frontage > road.lengthMeters) {
          along += SKIP_METERS;
          continue;
        }
        const tower = random.next() < style.towers;
        const floors = tower
          ? random.int(style.towerFloors[0], style.towerFloors[1])
          : random.int(style.floors[0], style.floors[1]);
        const depth = random.range(style.depth[0], style.depth[1]) * (tower ? 1.2 : 1);
        const setback = random.range(style.setback[0], style.setback[1]);
        // Its side of the street: the right of the way the road runs, or the left.
        const normalX = -middle.directionZ * side;
        const normalZ = middle.directionX * side;
        const reach = road.widthMeters / 2 + setback + depth / 2;
        const alongX = Math.abs(middle.directionX) > Math.abs(middle.directionZ);
        const x = middle.x + normalX * reach;
        const z = middle.z + normalZ * reach;
        // The district's own side of a street on its edge: the building, not the street, must lie in it.
        if (!inside(x, z)) {
          along += SKIP_METERS;
          continue;
        }
        const stood = plan.tryBuilding(
          x,
          z,
          alongX ? frontage : depth,
          alongX ? depth : frontage,
          heightOf(style, floors, random),
          undefined,
          {
            district: district.kind,
            shops: random.next() < style.shops,
            roadClearanceMeters: setback - 0.2,
            gapMeters: style.gap[0] * 0.5,
          },
        );
        along += stood ? frontage + random.range(style.gap[0], style.gap[1]) : SKIP_METERS;
      }
    }
  }
}

function fillBlocks(plan: CountryPlan, district: DistrictDefinition, random: SeededRandom): void {
  const style = STYLES[district.kind];
  const box = bounds(district);
  const step = style.back.step;
  for (let z = box.minZ + step / 2; z <= box.maxZ - step / 2; z += step) {
    for (let x = box.minX + step / 2; x <= box.maxX - step / 2; x += step) {
      const sizeX = random.range(style.back.size[0], style.back.size[1]);
      const sizeZ = random.range(style.back.size[0], style.back.size[1]);
      const floors = random.int(style.back.floors[0], style.back.floors[1]);
      // A little off the grid, so the blocks' middles do not stand in rows.
      const jitter = step * 0.18;
      plan.tryBuilding(
        x + random.range(-jitter, jitter),
        z + random.range(-jitter, jitter),
        Math.min(sizeX, step - BACK_GAP_METERS),
        Math.min(sizeZ, step - BACK_GAP_METERS),
        heightOf(style, floors, random),
        undefined,
        { district: district.kind, shops: false, roadClearanceMeters: BACK_ROAD_CLEARANCE_METERS, gapMeters: BACK_GAP_METERS },
      );
    }
  }
}
