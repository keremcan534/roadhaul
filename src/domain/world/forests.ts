import { SeededRandom } from '../../core/random/SeededRandom';
import { polygonContains, type ForestDefinition, type ForestKind, type Point2 } from '../../data/definitions/MapDefinition';
import type { Occupancy } from './countryside';
import type { RoadPath } from './RoadPath';

/** The kinds of tree the forests grow: the views' pines and broadleaves. */
export const FOREST_TREE_KINDS = ['pine', 'broadleaf'] as const;
export type ForestTreeKind = (typeof FOREST_TREE_KINDS)[number];

/** Near its edge, where the light reaches in, a forest's trees stand about this far apart, meters… */
const EDGE_SPACING_METERS = 6;
/** …within this far of its edge, meters. Deeper in they stand about this far apart, fewer and taller. */
export const FOREST_EDGE_BAND_METERS = 11;
/**
 * Only an edge seen from near by, within this far of a road, meters, grows
 * its close-set trees: from further off, an edge of trees like those deep in
 * looks the same, and is far cheaper to draw.
 */
export const FOREST_ROADSIDE_METERS = 100;
const INNER_SPACING_METERS = 11;
/** How big the trees grow (a scale on the views' tree): at the edge, and deeper in, where their crowns close over. */
const EDGE_SCALE = [0.85, 1.25] as const;
const INNER_SCALE = [1.3, 1.8] as const;
/** A forest tree's trunk (solid): its radius, and the room it keeps from anything else standing, meters. */
export const FOREST_TRUNK_RADIUS_METERS = 0.45;
const TRUNK_GAP_METERS = 1;
/** Each tree stands up to this share of the spacing off its place on the grid, each way. */
const JITTER = 0.4;
/** In a mixed forest, pines and broadleaves grow in stands about this big, meters. */
const STAND_METERS = 70;
/** A pine forest has this share of broadleaves among its pines, and a broadleaf forest this share of pines. */
const STRAY_SHARE = 0.12;

/** A forest as it stands: its outline and bounds, for where it is. */
export interface Forest {
  readonly id: string;
  readonly kind: ForestKind;
  readonly outline: readonly Point2[];
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** One of a forest's trees: where it stands, how big it is, what it is, and whether it stands deep in the forest. */
export interface ForestTree {
  readonly x: number;
  readonly z: number;
  readonly scale: number;
  readonly kind: ForestTreeKind;
  /**
   * Grown as deep in the forest: more than FOREST_EDGE_BAND_METERS in, where
   * its crown shows over the edge's trees, or on an edge no road passes near.
   */
  readonly inner: boolean;
}

export function createForest(definition: ForestDefinition): Forest {
  const xs = definition.outline.map(([x]) => x);
  const zs = definition.outline.map(([, z]) => z);
  return {
    id: definition.id,
    kind: definition.kind,
    outline: definition.outline,
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

/** Whether (x, z) lies inside the forest's outline. */
export function forestContains(forest: Forest, x: number, z: number): boolean {
  return x >= forest.minX && x <= forest.maxX && z >= forest.minZ && z <= forest.maxZ && polygonContains(forest.outline, x, z);
}

/** How far (x, z) lies from the forest's edge (its outline), meters, inside or out. */
export function distanceToForestEdge(forest: Forest, x: number, z: number): number {
  const outline = forest.outline;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < outline.length; i++) {
    const [ax, az] = outline[i]!;
    const [bx, bz] = outline[(i + 1) % outline.length]!;
    const dx = bx - ax;
    const dz = bz - az;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSquared)) : 0;
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return best;
}

/**
 * Plants a forest: trees on a jittered grid inside its outline, close
 * together within FOREST_EDGE_BAND_METERS of its edge and fewer but taller deeper
 * in, where their crowns close over. Only where `showsEdge` (the edge is
 * seen from near by: forestRoadside) does the edge grow close; elsewhere its
 * trees grow as those deep in. A pine forest grows pines with a few
 * broadleaves among them, a broadleaf forest the other way round, and a
 * mixed one stands of each. A tree stands only where `isClear` allows (not
 * on a road, a field or a river) and `occupancy` has room, where it is
 * filed in turn. The same seed always plants the same forest, and a tree
 * left out shifts none of the others.
 */
export function plantForest(
  forest: Forest,
  seed: number,
  isClear: (x: number, z: number) => boolean,
  occupancy: Occupancy,
  showsEdge: (x: number, z: number) => boolean = () => true,
): ForestTree[] {
  const random = new SeededRandom(seed ^ hashText(forest.id));
  const trees: ForestTree[] = [];
  const pass = (spacing: number, scales: readonly [number, number], inner: boolean): void => {
    for (let z = forest.minZ + spacing / 2; z < forest.maxZ; z += spacing) {
      for (let x = forest.minX + spacing / 2; x < forest.maxX; x += spacing) {
        // The same random numbers for every place on the grid, whether a tree grows there or not.
        const px = x + random.range(-JITTER, JITTER) * spacing;
        const pz = z + random.range(-JITTER, JITTER) * spacing;
        const scale = random.range(scales[0], scales[1]);
        const stray = random.next() < STRAY_SHARE;
        if (!forestContains(forest, px, pz)) {
          continue;
        }
        const deep = distanceToForestEdge(forest, px, pz) > FOREST_EDGE_BAND_METERS || !showsEdge(px, pz);
        if (deep !== inner || !isClear(px, pz) || !occupancy.isFree(px, pz, FOREST_TRUNK_RADIUS_METERS, TRUNK_GAP_METERS)) {
          continue;
        }
        occupancy.add(px, pz, FOREST_TRUNK_RADIUS_METERS);
        trees.push({ x: px, z: pz, scale, kind: kindAt(forest.kind, px, pz, stray, seed), inner });
      }
    }
  };
  pass(EDGE_SPACING_METERS, EDGE_SCALE, false);
  pass(INNER_SPACING_METERS, INNER_SCALE, true);
  return trees;
}

/**
 * Whether a point in or near `forest` lies within `reachMeters` of the edge
 * of one of `roads` (for plantForest's `showsEdge`), judged from the roads'
 * samples near the forest, a few meters apart.
 */
export function forestRoadside(forest: Forest, roads: readonly RoadPath[], reachMeters: number): (x: number, z: number) => boolean {
  const near: number[] = [];
  for (const road of roads) {
    const reach = road.widthMeters / 2 + reachMeters;
    for (let i = 0; i < road.pointCount; i++) {
      const x = road.x(i);
      const z = road.z(i);
      if (x > forest.minX - reach && x < forest.maxX + reach && z > forest.minZ - reach && z < forest.maxZ + reach) {
        near.push(x, z, reach);
      }
    }
  }
  return (x, z) => {
    for (let k = 0; k < near.length; k += 3) {
      if (Math.hypot(x - near[k]!, z - near[k + 1]!) < near[k + 2]!) {
        return true;
      }
    }
    return false;
  };
}

/** What grows at (x, z) in a forest of `kind`: `stray` picks the odd one out. */
function kindAt(kind: ForestKind, x: number, z: number, stray: boolean, seed: number): ForestTreeKind {
  const main: ForestTreeKind =
    kind === 'mixed' ? (cellHash(Math.floor(x / STAND_METERS), Math.floor(z / STAND_METERS), seed) < 0.5 ? 'pine' : 'broadleaf') : kind;
  if (!stray) {
    return main;
  }
  return main === 'pine' ? 'broadleaf' : 'pine';
}

/** A steady hash of a grid cell, 0..1. */
function cellHash(column: number, row: number, seed: number): number {
  let h = (Math.imul(column, 0x27d4eb2d) ^ Math.imul(row, 0x165667b1) ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A steady hash of an id, so each forest draws its own random numbers. */
function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h;
}
