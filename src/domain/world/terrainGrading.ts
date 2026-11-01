import { smoothstep } from '../../core/math/scalar';
import type { HillDefinition, RoadKind, TerrainDefinition } from '../../data/definitions/MapDefinition';
import type { RoadPath } from './RoadPath';
import { FLAT_TERRAIN, TerrainGrid, type Terrain } from './terrain';

/** The steepest a road climbs or falls, rise per meter (8%): a loaded truck still pulls away on it. */
export const MAX_ROAD_GRADE = 0.08;
/** The terrain grid's cell, meters: the ground's heights are kept this far apart. */
export const TERRAIN_CELL_METERS = 8;
/** A road's profile follows the ground smoothed over this far either way, meters: no bumps. */
const SMOOTH_METERS = 50;
/** The ground is level with the road this far past its edge (its verge), then eases back to its own over BLEND. */
const VERGE_METERS = 3;
const BLEND_METERS = 28;
/** Which roads are graded first, and so keep their line where later ones meet them: the bigger, the earlier. */
const GRADING_ORDER: Readonly<Record<RoadKind, number>> = { highway: 0, ringRoad: 1, street: 2, rural: 3, lane: 4 };

/**
 * The height of the map's hills at (x, z): each a smooth dome (a cosine's
 * crest), its height at its middle falling to nothing at its radius; they
 * add up where they overlap.
 */
export function hillsHeight(hills: readonly HillDefinition[], x: number, z: number): number {
  let height = 0;
  for (const hill of hills) {
    const dx = x - hill.x;
    const dz = z - hill.z;
    const squared = dx * dx + dz * dz;
    if (squared < hill.radiusMeters * hill.radiusMeters) {
      height += hill.heightMeters * 0.5 * (1 + Math.cos((Math.PI * Math.sqrt(squared)) / hill.radiusMeters));
    }
  }
  return height;
}

/**
 * The ground of a map with hills, and every road graded through it, as a
 * road builder would: the biggest roads first, each road's height along it
 * the ground's smoothed and held to MAX_ROAD_GRADE (and to its own held
 * heights: a bridge's deck, an overpass), where it meets a road graded
 * before it at that road's height; then the ground cut and filled level
 * with it out past its verge, easing back to its own height beyond. The
 * ground is not raised to a stretch carried on a deck. Writes each road's
 * `heights`. A map without terrain stays flat: FLAT_TERRAIN, its roads at 0.
 */
export function gradeTerrain(terrain: TerrainDefinition | undefined, halfSizeMeters: number, roads: readonly RoadPath[]): Terrain {
  const held = roads.some((road) => (road.profile?.length ?? 0) > 0);
  if ((terrain === undefined || terrain.hills.length === 0) && !held) {
    return FLAT_TERRAIN;
  }
  const hills = terrain?.hills ?? [];
  const grid = new TerrainGrid(halfSizeMeters, TERRAIN_CELL_METERS);
  raiseHills(grid, hills);
  const grading = new Grading(grid);
  const order = roads
    .map((road, index) => ({ road, index }))
    .sort((a, b) => GRADING_ORDER[a.road.kind] - GRADING_ORDER[b.road.kind] || a.index - b.index);
  for (const { road } of order) {
    profileRoad(road, grid, grading);
    grading.stamp(road);
  }
  return grid;
}

/** Adds each hill to the grid, visiting only the vertices under it. */
function raiseHills(grid: TerrainGrid, hills: readonly HillDefinition[]): void {
  const columns = grid.columns;
  for (const hill of hills) {
    const fromI = Math.max(0, Math.floor((hill.x - hill.radiusMeters - grid.vertexX(0)) / grid.cellMeters));
    const toI = Math.min(columns - 1, Math.ceil((hill.x + hill.radiusMeters - grid.vertexX(0)) / grid.cellMeters));
    const fromJ = Math.max(0, Math.floor((hill.z - hill.radiusMeters - grid.vertexZ(0)) / grid.cellMeters));
    const toJ = Math.min(columns - 1, Math.ceil((hill.z + hill.radiusMeters - grid.vertexZ(0)) / grid.cellMeters));
    for (let j = fromJ; j <= toJ; j++) {
      for (let i = fromI; i <= toI; i++) {
        grid.heights[j * columns + i]! += hillsHeight([hill], grid.vertexX(i), grid.vertexZ(j));
      }
    }
  }
}

/**
 * A road's heights: the ground under it (already level with the roads
 * graded before it where it meets them: those samples are held), smoothed,
 * then held to its own held heights and to MAX_ROAD_GRADE.
 */
function profileRoad(road: RoadPath, grid: TerrainGrid, grading: Grading): void {
  const count = road.pointCount;
  const raw = new Float64Array(count);
  const pinned = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    raw[i] = grid.heightAt(road.x(i), road.z(i));
    // On a road graded before it (a junction, a road it joins): held at that road's height.
    if (grading.pavedAt(road.x(i), road.z(i)) && road.elevated[i] === 0) {
      pinned[i] = 1;
    }
  }
  const heights = road.heights;
  // Smoothed along the road (a running average over SMOOTH_METERS each way); held samples keep their height.
  let from = 0;
  let to = 0;
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const at = road.distances[i]!;
    while (to < count && road.distances[to]! <= at + SMOOTH_METERS) {
      sum += raw[to]!;
      to++;
    }
    while (road.distances[from]! < at - SMOOTH_METERS) {
      sum -= raw[from]!;
      from++;
    }
    heights[i] = pinned[i] === 1 ? raw[i]! : sum / (to - from);
  }
  // Its own held heights: between two, the line between them; one alone holds only its sample.
  const profile = road.profile ?? [];
  if (profile.length > 0) {
    for (let i = 0; i < count; i++) {
      const at = road.distances[i]!;
      const first = profile[0]!;
      const last = profile[profile.length - 1]!;
      if (at < first.atMeters - 1e-6 || at > last.atMeters + 1e-6) {
        continue;
      }
      let k = 0;
      while (k < profile.length - 1 && profile[k + 1]!.atMeters < at) {
        k++;
      }
      const a = profile[k]!;
      const b = profile[Math.min(k + 1, profile.length - 1)]!;
      const t = b.atMeters > a.atMeters ? (at - a.atMeters) / (b.atMeters - a.atMeters) : 0;
      heights[i] = a.heightMeters + (b.heightMeters - a.heightMeters) * Math.min(1, Math.max(0, t));
      pinned[i] = 1;
    }
  }
  limitGrade(road, pinned);
}

/** Holds the road's free samples within MAX_ROAD_GRADE of their neighbours, both ways along it. */
function limitGrade(road: RoadPath, pinned: Uint8Array): void {
  const heights = road.heights;
  const count = road.pointCount;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < count; i++) {
      if (pinned[i] === 0) {
        const rise = MAX_ROAD_GRADE * (road.distances[i]! - road.distances[i - 1]!);
        heights[i] = Math.min(heights[i - 1]! + rise, Math.max(heights[i - 1]! - rise, heights[i]!));
      }
    }
    for (let i = count - 2; i >= 0; i--) {
      if (pinned[i] === 0) {
        const rise = MAX_ROAD_GRADE * (road.distances[i + 1]! - road.distances[i]!);
        heights[i] = Math.min(heights[i + 1]! + rise, Math.max(heights[i + 1]! - rise, heights[i]!));
      }
    }
  }
}

/**
 * The ground being graded: for each vertex, how far it is outside the
 * paved verge of the roads graded so far (0 on one), so later roads meet
 * them at their height and do not cut into them.
 */
class Grading {
  private readonly outside: Float32Array;
  /** Per vertex, for the road being stamped: its nearest distance to the centreline and the road's height there. */
  private readonly distance: Float32Array;
  private readonly height: Float32Array;
  private readonly mark: Int32Array;
  private readonly touched: number[] = [];
  private road = 0;

  constructor(private readonly grid: TerrainGrid) {
    const size = grid.columns * grid.columns;
    this.outside = new Float32Array(size).fill(Infinity);
    this.distance = new Float32Array(size);
    this.height = new Float32Array(size);
    this.mark = new Int32Array(size).fill(-1);
  }

  /** Whether (x, z) lies on the paved verge of a road graded already: all four corners of its cell are level with it. */
  pavedAt(x: number, z: number): boolean {
    const grid = this.grid;
    const v = grid.cellOf(z) * grid.columns + grid.cellOf(x);
    const outside = this.outside;
    return outside[v] === 0 && outside[v + 1] === 0 && outside[v + grid.columns] === 0 && outside[v + grid.columns + 1] === 0;
  }

  /** Levels the ground with `road` out past its verge and eases it back beyond; deck stretches are left alone. */
  stamp(road: RoadPath): void {
    const grid = this.grid;
    const columns = grid.columns;
    const level = road.widthMeters / 2 + VERGE_METERS;
    const reach = level + BLEND_METERS;
    const id = this.road++;
    this.touched.length = 0;
    for (let s = 0; s < road.segmentCount; s++) {
      const next = (s + 1) % road.pointCount;
      if (road.elevated[s] === 1 && road.elevated[next] === 1) {
        continue;
      }
      const ax = road.x(s);
      const az = road.z(s);
      const bx = road.x(next);
      const bz = road.z(next);
      const fromI = Math.max(0, Math.floor((Math.min(ax, bx) - reach - grid.vertexX(0)) / grid.cellMeters));
      const toI = Math.min(columns - 1, Math.ceil((Math.max(ax, bx) + reach - grid.vertexX(0)) / grid.cellMeters));
      const fromJ = Math.max(0, Math.floor((Math.min(az, bz) - reach - grid.vertexZ(0)) / grid.cellMeters));
      const toJ = Math.min(columns - 1, Math.ceil((Math.max(az, bz) + reach - grid.vertexZ(0)) / grid.cellMeters));
      const ex = bx - ax;
      const ez = bz - az;
      const lengthSquared = ex * ex + ez * ez;
      for (let j = fromJ; j <= toJ; j++) {
        const z = grid.vertexZ(j);
        for (let i = fromI; i <= toI; i++) {
          const x = grid.vertexX(i);
          const t = lengthSquared > 0 ? Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / lengthSquared)) : 0;
          const px = ax + ex * t - x;
          const pz = az + ez * t - z;
          const d = Math.sqrt(px * px + pz * pz);
          if (d > reach) {
            continue;
          }
          const v = j * columns + i;
          if (this.mark[v] !== id) {
            this.mark[v] = id;
            this.distance[v] = Infinity;
            this.touched.push(v);
          }
          if (d < this.distance[v]!) {
            this.distance[v] = d;
            this.height[v] = road.heights[s]! + (road.heights[next]! - road.heights[s]!) * t;
          }
        }
      }
    }
    for (const v of this.touched) {
      const d = this.distance[v]!;
      const beyond = Math.max(0, d - level);
      // A road graded before keeps its own verge.
      if (this.outside[v] === 0) {
        continue;
      }
      const weight = beyond === 0 ? 1 : 1 - smoothstep(0, BLEND_METERS, beyond);
      grid.heights[v] = grid.heights[v]! + (this.height[v]! - grid.heights[v]!) * weight;
      this.outside[v] = Math.min(this.outside[v]!, beyond);
    }
  }
}
