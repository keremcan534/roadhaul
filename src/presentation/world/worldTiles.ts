import { Box3, type Frustum, type Object3D } from 'three';
import type { RoadPath } from '../../domain/world/RoadPath';

/**
 * The heaviest of what the country grew (DrivingWorld.mapRoadCount: the
 * asphalt and shoulders of the villages' and side roads' roads, the plinths
 * and roofs of the houses and farms along them) is drawn in square tiles
 * this big, meters, each its own few meshes, so only the tiles near the
 * camera are drawn (FarCulling).
 */
export const COUNTRY_TILE_METERS = 1200;

/**
 * Past this far from the camera, meters, the world's tiles are hidden
 * (FarCulling): lost in the haze, whatever the weather (a tenth of their
 * colour shows through it on the clearest day). The far plane is flat, as
 * far ahead, so the view reaches much further in its corners.
 */
export const FAR_CULL_METERS = 1000;

/** The tile of `tileMeters` holding (x, z), as a key. */
export function tileKeyOf(x: number, z: number, tileMeters = COUNTRY_TILE_METERS): string {
  return `${Math.floor(x / tileMeters)},${Math.floor(z / tileMeters)}`;
}

/** Parts filed by the tile they lie in. */
export class TileParts<T> {
  readonly tiles = new Map<string, T[]>();

  constructor(readonly tileMeters = COUNTRY_TILE_METERS) {}

  add(x: number, z: number, part: T): void {
    const key = tileKeyOf(x, z, this.tileMeters);
    const tile = this.tiles.get(key);
    if (tile === undefined) {
      this.tiles.set(key, [part]);
    } else {
      tile.push(part);
    }
  }
}

/** A run of a ribbon's rows within one tile, and a point of it for filing it there. */
export interface TileRun {
  readonly x: number;
  readonly z: number;
  readonly rows: readonly number[];
}

/**
 * A ribbon's rows (ribbonRows: ascending, a closed road's last row its
 * first sample again) cut where the ribbon crosses from tile to tile: runs
 * that each share their first row with the last of the run before, filed by
 * the middle of their first piece.
 */
export function tileRuns(road: RoadPath, rows: readonly number[], tileMeters = COUNTRY_TILE_METERS): TileRun[] {
  const count = road.pointCount;
  const runs: TileRun[] = [];
  if (rows.length < 2) {
    return rows.length === 1 ? [{ x: road.x(rows[0]! % count), z: road.z(rows[0]! % count), rows: [rows[0]!] }] : runs;
  }
  let start = 0;
  let key = '';
  let x = 0;
  let z = 0;
  for (let piece = 0; piece < rows.length - 1; piece++) {
    const a = rows[piece]! % count;
    const b = rows[piece + 1]! % count;
    const middleX = (road.x(a) + road.x(b)) / 2;
    const middleZ = (road.z(a) + road.z(b)) / 2;
    const pieceKey = tileKeyOf(middleX, middleZ, tileMeters);
    if (piece === 0) {
      key = pieceKey;
      x = middleX;
      z = middleZ;
    } else if (pieceKey !== key) {
      runs.push({ x, z, rows: rows.slice(start, piece + 1) });
      start = piece;
      key = pieceKey;
      x = middleX;
      z = middleZ;
    }
  }
  runs.push({ x, z, rows: rows.slice(start) });
  return runs;
}

/**
 * Fixes the transforms of `root` and everything under it as they stand, for
 * what never moves once built: three.js otherwise recomposes every object's
 * matrix every frame. About an eighth of a low-end phone's frame went on the
 * static world's thousand-odd objects. Nor does it walk them every frame any
 * more: the scene's update stops at `root` (three.js walks every object, frozen
 * or not, which was still a few percent of that frame). Instanced meshes keep
 * moving their instances; nothing under `root` may move, nor may anything be
 * added under it later.
 */
export function freezeTransforms(root: Object3D): void {
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    object.matrixAutoUpdate = false;
  });
  root.updateMatrixWorld = keepMatrixWorld;
}

/** A frozen root's updateMatrixWorld (freezeTransforms): its world matrices, and those under it, stay as they are. */
function keepMatrixWorld(): void {}

/**
 * A tile is kept while its box comes this near the view, meters: the trees
 * sway and the grass bends past the meshes' own bounds in their shaders.
 */
const VIEW_MARGIN_METERS = 6;

/**
 * Hides what lies too far from the camera to see: objects (a tile's
 * meshes, grouped), each with the rectangle of ground it covers, shown only
 * while that rectangle comes within `reachMeters` of the camera; and, given
 * the camera's view, only while its box (and a margin) is in it, so three.js
 * does not look over each of a tile's meshes to leave them out one by one.
 */
export class FarCulling {
  private readonly objects: Object3D[] = [];
  /** Each object's box: min x, max x, min z, max z, min y, max y. */
  private bounds = new Float64Array(96);
  private readonly reachSquared: number;
  private readonly box = new Box3();

  constructor(reachMeters = FAR_CULL_METERS) {
    this.reachSquared = reachMeters * reachMeters;
  }

  get size(): number {
    return this.objects.length;
  }

  /** Culls `object` from now on, by the ground its meshes (as they stand now) cover. */
  add(object: Object3D): void {
    const box = new Box3().setFromObject(object);
    if (box.isEmpty()) {
      return;
    }
    const at = this.objects.length * 6;
    if (at + 6 > this.bounds.length) {
      const grown = new Float64Array(this.bounds.length * 2);
      grown.set(this.bounds);
      this.bounds = grown;
    }
    this.bounds.set([box.min.x, box.max.x, box.min.z, box.max.z, box.min.y, box.max.y], at);
    this.objects.push(object);
  }

  /**
   * Shows the objects near (x, z), the camera, and hides the others; given
   * the camera's `view` (its frustum as it will be drawn), also those out of
   * it. Leave the view out where something is drawn from another camera
   * too (the shadow map's: a tile out of view can cast a shadow into it).
   * Allocation-free: call it every frame.
   */
  update(x: number, z: number, view: Frustum | null = null): void {
    const bounds = this.bounds;
    const box = this.box;
    for (let i = 0; i < this.objects.length; i++) {
      const at = i * 6;
      const dx = Math.max(bounds[at]! - x, 0, x - bounds[at + 1]!);
      const dz = Math.max(bounds[at + 2]! - z, 0, z - bounds[at + 3]!);
      let shown = dx * dx + dz * dz <= this.reachSquared;
      if (shown && view !== null) {
        box.min.set(bounds[at]! - VIEW_MARGIN_METERS, bounds[at + 4]! - VIEW_MARGIN_METERS, bounds[at + 2]! - VIEW_MARGIN_METERS);
        box.max.set(bounds[at + 1]! + VIEW_MARGIN_METERS, bounds[at + 5]! + VIEW_MARGIN_METERS, bounds[at + 3]! + VIEW_MARGIN_METERS);
        shown = view.intersectsBox(box);
      }
      this.objects[i]!.visible = shown;
    }
  }
}
