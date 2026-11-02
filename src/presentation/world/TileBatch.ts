import { BatchedMesh, type BatchedMeshGeometryRange, type BufferAttribute, type BufferGeometry, type Frustum, type Material } from 'three';
import { FarCulling, FAR_CULL_METERS, type Cullable } from './worldTiles';

/**
 * Tiles of what never moves, of one material, drawn as one: each tile's
 * geometry (in the world's coordinates, merged) kept once in a BatchedMesh,
 * an instance at the identity; FarCulling shows the tiles near the camera
 * and, given its view, in it; the batch draws those it shows in one draw call
 * (WEBGL_multi_draw; without it three.js draws their ranges one by one, the
 * material still set up once). As separate meshes each tile cost a draw:
 * the material's forty-odd uniforms looked over, its matrices sent, its
 * buffers bound. The tiles' triangles are the same, so is the picture.
 *
 * The batch holds the tiles' vertices: a tile's are at `vertexStartOf(tile)`
 * in `positions` (to move some and upload only those). Draws nothing (not even
 * an empty draw) while no tile is shown.
 */
export class TileBatch {
  readonly mesh: BatchedMesh;
  private readonly culling: FarCulling;
  private readonly shown: Uint8Array;
  private readonly vertexStarts: Uint32Array;
  private shownCount = 0;

  /**
   * `geometries` are copied in (and may be disposed after); `reachMeters` as
   * FarCulling's. A batch that `cullsItself` leaves FarCulling out: the batch
   * looks over its tiles against the camera's view each time it is drawn (for
   * a few tiles that update() is never asked of).
   */
  constructor(geometries: readonly BufferGeometry[], material: Material, name: string, reachMeters = FAR_CULL_METERS, cullsItself = false) {
    let vertices = 0;
    let indices = 0;
    for (const geometry of geometries) {
      vertices += geometry.getAttribute('position').count;
      indices += geometry.index?.count ?? 0;
    }
    this.mesh = new BatchedMesh(Math.max(1, geometries.length), Math.max(1, vertices), Math.max(1, indices), material);
    this.mesh.name = name;
    // FarCulling culls the tiles (shown to the shadow map's camera too), and order does not matter to what is opaque.
    this.mesh.perObjectFrustumCulled = cullsItself;
    this.mesh.sortObjects = false;
    this.mesh.frustumCulled = false;
    this.culling = new FarCulling(reachMeters);
    this.shown = new Uint8Array(geometries.length).fill(1);
    this.shownCount = geometries.length;
    this.vertexStarts = new Uint32Array(geometries.length);
    const range: BatchedMeshGeometryRange = { vertexStart: 0, vertexCount: 0, reservedVertexCount: 0, indexStart: 0, indexCount: 0, reservedIndexCount: 0, start: 0, count: 0 };
    geometries.forEach((geometry, tile) => {
      const geometryId = this.mesh.addGeometry(geometry);
      const instance = this.mesh.addInstance(geometryId);
      if (instance !== tile) {
        throw new Error(`TileBatch: tile ${tile} became instance ${instance}.`);
      }
      this.vertexStarts[tile] = this.mesh.getGeometryRangeAt(geometryId, range)!.vertexStart;
      if (geometry.boundingBox === null) {
        geometry.computeBoundingBox();
      }
      this.culling.addBox(new TileSlot(this, tile), geometry.boundingBox!);
    });
    // The buffers go to the GPU whole the first time they are drawn: the ranges the batch marked as it copied each tile
    // in would otherwise be uploaded again, all of them, with the first change after (a prop knocked over).
    for (const attribute of Object.values(this.mesh.geometry.attributes)) {
      (attribute as BufferAttribute).clearUpdateRanges();
    }
    this.mesh.geometry.index?.clearUpdateRanges();
    this.mesh.visible = geometries.length > 0;
  }

  /** How many tiles it holds. */
  get size(): number {
    return this.shown.length;
  }

  /** The batch's positions, the tiles' end to end. */
  get positions(): BufferAttribute {
    return this.mesh.geometry.getAttribute('position') as BufferAttribute;
  }

  /** Where `tile`'s vertices start in `positions`, vertices. */
  vertexStartOf(tile: number): number {
    return this.vertexStarts[tile]!;
  }

  /** Whether `tile` is drawn (as of the last update). */
  isShown(tile: number): boolean {
    return this.shown[tile] === 1;
  }

  /** Shows or hides `tile` (FarCulling's TileSlot). */
  show(tile: number, shown: boolean): void {
    const flag = shown ? 1 : 0;
    if (this.shown[tile] === flag) {
      return;
    }
    this.shown[tile] = flag;
    this.shownCount += shown ? 1 : -1;
    this.mesh.setVisibleAt(tile, shown);
  }

  /** Shows the tiles near (x, z), the camera, and (given its view) in it, as FarCulling.update. Allocation-free. */
  update(x: number, z: number, view: Frustum | null = null): void {
    this.culling.update(x, z, view);
    this.mesh.visible = this.shownCount > 0;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
  }
}

/** A tile of a TileBatch as FarCulling sees it: an object it shows and hides. */
class TileSlot implements Cullable {
  constructor(
    private readonly batch: TileBatch,
    private readonly tile: number,
  ) {}

  get visible(): boolean {
    return this.batch.isShown(this.tile);
  }

  set visible(shown: boolean) {
    this.batch.show(this.tile, shown);
  }
}
