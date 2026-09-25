import { SeededRandom } from '../../core/random/SeededRandom';
import type { FieldCrop, Point2, RectangleDefinition } from '../../data/definitions/MapDefinition';
import { createRoadPoint, type RoadPath } from './RoadPath';

/**
 * The countryside's scenery, placed once from the map's seed (the same seed
 * always gives the same land): power lines along the country roads, fences
 * and dry-stone walls along the fields, boulders, flocks of sheep and herds
 * of cows at pasture, and planted trees: poplars in windbreaks behind
 * fields, olive groves and cypresses. Everything solid keeps clear of the
 * roads, yards, fields and buildings (SceneryGround.isClear) and of what is
 * placed already (Occupancy).
 */

/** A pole of an overhead power line: where it stands, the way the line runs there, and its trunk's radius. */
export interface Pole {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly radius: number;
}

/** An overhead power line along a road: its poles in a row, wired each to the next. */
export interface PowerLine {
  readonly poles: readonly Pole[];
}

export const FIELD_EDGE_KINDS = ['fence', 'wall'] as const;
export type FieldEdgeKind = (typeof FIELD_EDGE_KINDS)[number];

/** A straight run of a field's boundary along its road: a wooden fence or a dry-stone wall. Scenery: not solid. */
export interface FieldEdge {
  readonly kind: FieldEdgeKind;
  readonly from: Point2;
  readonly to: Point2;
}

/** A boulder: its size (meters across), its turn, and the radius the truck hits. */
export interface Rock {
  readonly x: number;
  readonly z: number;
  readonly size: number;
  readonly turn: number;
  readonly radius: number;
}

export const GRAZER_KINDS = ['sheep', 'cow'] as const;
export type GrazerKind = (typeof GRAZER_KINDS)[number];

/** An animal at pasture, facing `heading` (0 along +z). */
export interface Grazer {
  readonly kind: GrazerKind;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly radius: number;
}

export const TREE_SPECIES = ['poplar', 'cypress', 'olive'] as const;
export type TreeSpecies = (typeof TREE_SPECIES)[number];

/** A tree planted by people (the wild ones are the views' pines and broadleaves). */
export interface PlantedTree {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly scale: number;
  readonly species: TreeSpecies;
}

/** What placing the scenery needs to know of the world. */
export interface SceneryGround {
  readonly roads: readonly RoadPath[];
  readonly fields: readonly { readonly area: RectangleDefinition; readonly crop: FieldCrop }[];
  /** Whether something as big as a tree may stand at (x, z): clear of roads, yards, fields, buildings and water. */
  isClear(x: number, z: number): boolean;
  /** Whether (x, z) is closer than `clearanceMeters` (at most SCENERY_ROAD_REACH_METERS) to any road's edge. */
  nearRoad(x: number, z: number, clearanceMeters: number): boolean;
}

/** The farthest from a road the scenery asks whether it is near one (SceneryGround.nearRoad). */
export const SCENERY_ROAD_REACH_METERS = 30;

const OCCUPANCY_CELL_METERS = 16;

/** Where solid things stand already, filed by grid cell: nothing new is put on top of them. */
export class Occupancy {
  private readonly cells = new Map<string, number[]>();

  /** Files a solid circle. */
  add(x: number, z: number, radius: number): void {
    const key = `${Math.floor(x / OCCUPANCY_CELL_METERS)},${Math.floor(z / OCCUPANCY_CELL_METERS)}`;
    const cell = this.cells.get(key);
    if (cell === undefined) {
      this.cells.set(key, [x, z, radius]);
    } else {
      cell.push(x, z, radius);
    }
  }

  /** Whether a circle of `radius` at (x, z) keeps `gap` meters from every circle filed. */
  isFree(x: number, z: number, radius: number, gap: number): boolean {
    const column = Math.floor(x / OCCUPANCY_CELL_METERS);
    const row = Math.floor(z / OCCUPANCY_CELL_METERS);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cell = this.cells.get(`${column + dx},${row + dz}`);
        if (cell === undefined) {
          continue;
        }
        for (let i = 0; i < cell.length; i += 3) {
          if (Math.hypot(cell[i]! - x, cell[i + 1]! - z) < cell[i + 2]! + radius + gap) {
            return false;
          }
        }
      }
    }
    return true;
  }
}

/** Power poles stand this far apart along a country road, this far out from its edge, on alternate roads' sides. */
export const POLE_SPACING_METERS = 42;
const POLE_OUT_METERS = 6.5;
export const POLE_RADIUS_METERS = 0.16;
/** A line breaks where a pole cannot stand: wires never span further than this. */
const MAX_SPAN_METERS = 60;
/** A field's boundary has a gate this wide in the middle of its side along the road. */
export const GATE_WIDTH_METERS = 6;
/** Boulders lie in this many clusters of up to this many, this far round each cluster's middle, well off the roads. */
const ROCK_CLUSTERS = 46;
const ROCKS_PER_CLUSTER = 7;
const ROCK_SCATTER_METERS = 11;
const ROCK_ROAD_CLEARANCE_METERS = 10;
/** The herds: sheep and cows, how many of each, how widely they spread, and how far off the road they graze. */
const HERDS: readonly { readonly kind: GrazerKind; readonly count: number }[] = [
  { kind: 'sheep', count: 18 },
  { kind: 'cow', count: 6 },
  { kind: 'sheep', count: 22 },
  { kind: 'cow', count: 7 },
  { kind: 'sheep', count: 15 },
];
const HERD_SPREAD_METERS: Readonly<Record<GrazerKind, number>> = { sheep: 13, cow: 18 };
const GRAZER_RADIUS_METERS: Readonly<Record<GrazerKind, number>> = { sheep: 0.55, cow: 0.95 };
const PASTURE_FROM_ROAD_METERS = [26, 60] as const;
const GRAZER_ROAD_CLEARANCE_METERS = 12;
/** Planted trees: poplars this far apart in a windbreak this far behind a field; groves and rows of the others. */
const POPLAR_SPACING_METERS = 6;
const WINDBREAK_BEHIND_METERS = 4;
const OLIVE_SPACING_METERS = 7;
const CYPRESS_SPACING_METERS = 8;
const PLANTED_TRUNK_RADIUS: Readonly<Record<TreeSpecies, number>> = { poplar: 0.3, cypress: 0.35, olive: 0.4 };

/** The distance from (x, z) to the nearest road's edge (negative on a road). */
function roadEdgeDistance(roads: readonly RoadPath[], x: number, z: number): number {
  let nearest = Infinity;
  for (const road of roads) {
    nearest = Math.min(nearest, road.distanceTo(x, z) - road.widthMeters / 2);
  }
  return nearest;
}

/**
 * Power lines on wooden poles along the country roads (on the right of one,
 * the left of the next), a pole every POLE_SPACING_METERS just past the
 * verge. Where a pole cannot stand (a junction, a tree, a sign) the line
 * breaks off and starts again at the next; a pole alone carries no line and
 * is left out. The poles are solid (filed in `occupancy`).
 */
export function placePowerLines(ground: SceneryGround, occupancy: Occupancy): PowerLine[] {
  const lines: PowerLine[] = [];
  const point = createRoadPoint();
  let rural = 0;
  for (const road of ground.roads) {
    if (road.kind !== 'rural') {
      continue;
    }
    // Right of the direction of travel is (-uz, ux).
    const side = rural++ % 2 === 0 ? 1 : -1;
    const out = side * (road.widthMeters / 2 + POLE_OUT_METERS);
    let run: Pole[] = [];
    const close = (): void => {
      if (run.length >= 2) {
        lines.push({ poles: run });
        for (const pole of run) {
          occupancy.add(pole.x, pole.z, pole.radius);
        }
      }
      run = [];
    };
    for (let along = POLE_SPACING_METERS / 2; along < road.lengthMeters; along += POLE_SPACING_METERS) {
      road.pointAt(along, point);
      const x = point.x - point.directionZ * out;
      const z = point.z + point.directionX * out;
      if (!ground.isClear(x, z) || !occupancy.isFree(x, z, POLE_RADIUS_METERS, 1.5)) {
        close();
        continue;
      }
      const last = run[run.length - 1];
      if (last !== undefined && Math.hypot(last.x - x, last.z - z) > MAX_SPAN_METERS) {
        close();
      }
      run.push({ x, z, heading: Math.atan2(point.directionX, point.directionZ), radius: POLE_RADIUS_METERS });
    }
    close();
  }
  return lines;
}

/** A field's rectangle as its corners' frame: its middle, the way along its length and the way across it. */
function fieldFrame(area: RectangleDefinition): { alongX: number; alongZ: number; acrossX: number; acrossZ: number } {
  const heading = (area.headingDegrees * Math.PI) / 180;
  return { alongX: Math.sin(heading), alongZ: Math.cos(heading), acrossX: Math.cos(heading), acrossZ: -Math.sin(heading) };
}

/** Which long side of `area` (+1 or -1 across it) is nearer a road: the one the field faces. */
function roadSideOf(ground: SceneryGround, area: RectangleDefinition): 1 | -1 {
  const { acrossX, acrossZ } = fieldFrame(area);
  const distance = (side: number): number =>
    roadEdgeDistance(ground.roads, area.x + acrossX * side * (area.widthMeters / 2), area.z + acrossZ * side * (area.widthMeters / 2));
  return distance(1) <= distance(-1) ? 1 : -1;
}

/**
 * The fields' boundaries along their roads: a post-and-rail fence round the
 * grain (wheat, stubble), a dry-stone wall round the others, each with a
 * gate in the middle. Scenery the truck drives through.
 */
export function placeFieldEdges(ground: SceneryGround): FieldEdge[] {
  const edges: FieldEdge[] = [];
  for (const field of ground.fields) {
    const { area } = field;
    const { alongX, alongZ, acrossX, acrossZ } = fieldFrame(area);
    const side = roadSideOf(ground, area);
    const middleX = area.x + acrossX * side * (area.widthMeters / 2);
    const middleZ = area.z + acrossZ * side * (area.widthMeters / 2);
    const half = area.lengthMeters / 2;
    const gate = GATE_WIDTH_METERS / 2;
    const kind: FieldEdgeKind = field.crop === 'wheat' || field.crop === 'stubble' ? 'fence' : 'wall';
    edges.push(
      { kind, from: [middleX - alongX * half, middleZ - alongZ * half], to: [middleX - alongX * gate, middleZ - alongZ * gate] },
      { kind, from: [middleX + alongX * gate, middleZ + alongZ * gate], to: [middleX + alongX * half, middleZ + alongZ * half] },
    );
  }
  return edges;
}

/**
 * Boulders in clusters across the open country, well off the roads, not in
 * fields or on anything placed already. Each candidate draws the same random
 * numbers whether it stands or not, so one left out moves no other.
 */
export function placeRocks(ground: SceneryGround, occupancy: Occupancy, halfSizeMeters: number, seed: number): Rock[] {
  const random = new SeededRandom(seed ^ 0x2f6b1d);
  const rocks: Rock[] = [];
  const reach = halfSizeMeters - 60;
  for (let cluster = 0; cluster < ROCK_CLUSTERS; cluster++) {
    const centreX = random.range(-reach, reach);
    const centreZ = random.range(-reach, reach);
    const count = random.int(2, ROCKS_PER_CLUSTER);
    for (let i = 0; i < ROCKS_PER_CLUSTER; i++) {
      const angle = random.range(0, Math.PI * 2);
      const distance = Math.sqrt(random.next()) * ROCK_SCATTER_METERS;
      const size = random.next() < 0.15 ? random.range(1.6, 2.6) : random.range(0.5, 1.4);
      const turn = random.range(0, Math.PI * 2);
      if (i >= count) {
        continue;
      }
      const x = centreX + Math.cos(angle) * distance;
      const z = centreZ + Math.sin(angle) * distance;
      const radius = size * 0.45;
      if (ground.isClear(x, z) && !ground.nearRoad(x, z, ROCK_ROAD_CLEARANCE_METERS) && occupancy.isFree(x, z, radius, 0.6)) {
        rocks.push({ x, z, size, turn, radius });
        occupancy.add(x, z, radius);
      }
    }
  }
  return rocks;
}

/**
 * Flocks of sheep and herds of cows grazing on open grass beside the country
 * roads, each animal clear of the roads, the fields and one another. They
 * are solid: the truck stops for them.
 */
export function placeGrazers(ground: SceneryGround, occupancy: Occupancy, seed: number): Grazer[] {
  const random = new SeededRandom(seed ^ 0x51ee9);
  const grazers: Grazer[] = [];
  const rural = ground.roads.filter((road) => road.kind === 'rural');
  if (rural.length === 0) {
    return grazers;
  }
  const point = createRoadPoint();
  HERDS.forEach((herd, index) => {
    const road = rural[index % rural.length]!;
    const spread = HERD_SPREAD_METERS[herd.kind];
    const radius = GRAZER_RADIUS_METERS[herd.kind];
    for (let attempt = 0; attempt < 16; attempt++) {
      road.pointAt(random.range(0.12, 0.88) * road.lengthMeters, point);
      const side = random.sign();
      const out = side * (road.widthMeters / 2 + random.range(PASTURE_FROM_ROAD_METERS[0], PASTURE_FROM_ROAD_METERS[1]));
      const centreX = point.x - point.directionZ * out;
      const centreZ = point.z + point.directionX * out;
      if (!ground.isClear(centreX, centreZ) || ground.nearRoad(centreX, centreZ, GRAZER_ROAD_CLEARANCE_METERS + spread / 2)) {
        continue;
      }
      // Most face the same way down the slope of the wind, a few wander.
      const facing = random.range(0, Math.PI * 2);
      let placed = 0;
      for (let i = 0; i < herd.count * 3 && placed < herd.count; i++) {
        const angle = random.range(0, Math.PI * 2);
        const distance = Math.sqrt(random.next()) * spread;
        const heading = facing + random.range(-0.9, 0.9) + (random.next() < 0.2 ? Math.PI : 0);
        const x = centreX + Math.cos(angle) * distance;
        const z = centreZ + Math.sin(angle) * distance;
        if (ground.isClear(x, z) && !ground.nearRoad(x, z, GRAZER_ROAD_CLEARANCE_METERS) && occupancy.isFree(x, z, radius, 0.5)) {
          grazers.push({ kind: herd.kind, x, z, heading, radius });
          occupancy.add(x, z, radius);
          placed++;
        }
      }
      return;
    }
  });
  return grazers;
}

/**
 * Trees people planted: a windbreak of poplars behind every third field
 * (along its far side), two olive groves beside the first country road, and
 * rows of cypresses along the country roads where they reach a village.
 * Solid, like the wild trees.
 */
export function plantTrees(ground: SceneryGround, occupancy: Occupancy, seed: number): PlantedTree[] {
  const random = new SeededRandom(seed ^ 0x7ee5);
  const trees: PlantedTree[] = [];
  const plant = (x: number, z: number, species: TreeSpecies, scale: number): void => {
    const radius = PLANTED_TRUNK_RADIUS[species];
    if (ground.isClear(x, z) && occupancy.isFree(x, z, radius, 1.2)) {
      trees.push({ x, z, radius, scale, species });
      occupancy.add(x, z, radius);
    }
  };

  // Windbreaks: poplars along the far side of every third field.
  ground.fields.forEach((field, index) => {
    const scales = Array.from({ length: Math.ceil(field.area.lengthMeters / POPLAR_SPACING_METERS) + 1 }, () => random.range(0.85, 1.15));
    if (index % 3 !== 0) {
      return;
    }
    const { area } = field;
    const { alongX, alongZ, acrossX, acrossZ } = fieldFrame(area);
    const far = -roadSideOf(ground, area) * (area.widthMeters / 2 + WINDBREAK_BEHIND_METERS);
    scales.forEach((scale, i) => {
      const along = -area.lengthMeters / 2 + i * POPLAR_SPACING_METERS;
      if (along <= area.lengthMeters / 2) {
        plant(area.x + acrossX * far + alongX * along, area.z + acrossZ * far + alongZ * along, 'poplar', scale);
      }
    });
  });

  const rural = ground.roads.filter((road) => road.kind === 'rural');
  const point = createRoadPoint();
  // Olive groves: rows on a grid beside the first country road, the rows along it.
  const first = rural[0];
  if (first !== undefined) {
    for (const [fraction, side] of [
      [0.2, -1],
      [0.45, 1],
    ] as const) {
      first.pointAt(fraction * first.lengthMeters, point);
      const { directionX: ux, directionZ: uz } = point;
      for (let row = 0; row < 5; row++) {
        for (let column = 0; column < 7; column++) {
          const across = side * (first.widthMeters / 2 + 16 + row * OLIVE_SPACING_METERS);
          const along = (column - 3) * OLIVE_SPACING_METERS + random.range(-0.8, 0.8);
          const scale = random.range(0.8, 1.1);
          plant(point.x - uz * across + ux * along, point.z + ux * across + uz * along, 'olive', scale);
        }
      }
    }
  }
  // Cypresses along the last stretch of each country road into a village, and the first stretch out of one.
  for (const road of rural) {
    for (const [from, to] of [
      [40, 190],
      [road.lengthMeters - 190, road.lengthMeters - 40],
    ] as const) {
      for (let along = from; along <= to; along += CYPRESS_SPACING_METERS) {
        road.pointAt(along, point);
        const scale = random.range(0.85, 1.2);
        for (const side of [1, -1] as const) {
          const out = side * (road.widthMeters / 2 + 5.5);
          plant(point.x - point.directionZ * out, point.z + point.directionX * out, 'cypress', scale);
        }
      }
    }
  }
  return trees;
}
