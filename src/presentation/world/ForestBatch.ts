import { Box3, InstancedBufferAttribute, InstancedMesh, type Frustum, type Group, type Object3D } from 'three';

/** A tile is kept while its box comes this near the view, meters (the crowns sway past their bounds): FarCulling's. */
const VIEW_MARGIN_METERS = 6;

/** A kind of the forest's instanced meshes (its name: `forest:trunks`, `forest:crowns:pine`…) in one tile. */
interface TilePart {
  readonly mesh: InstancedMesh;
  /** What decides whether it is drawn: its tile (the crowns, the trunks), or itself (the shadows, the inner trunks). */
  readonly shown: Object3D;
  /** The ground its instances cover, grown by VIEW_MARGIN_METERS: culled by the view on its own, as three culled the mesh. */
  readonly box: Box3;
}

/** One kind's draw: every tile's instances of it that are in view, together. */
interface Slot {
  readonly batch: InstancedMesh;
  readonly parts: readonly TilePart[];
}

/**
 * The forest's tiles (TrackView.createTrees), drawn a kind at a time: the
 * instances of each kind of crown, the trunks, the inner trunks and the
 * shadows of every tile in view go into one instanced mesh, one draw call a
 * kind instead of one a kind a tile. The tiles are still culled as before
 * (FarCulling sets their `visible`, the detail's sets the shadows' and inner
 * trunks'); their own meshes are no longer drawn, the batches are filled
 * again from them whenever what is in view changes. The same instances, the
 * same materials: the same picture.
 */
export class ForestBatch {
  private readonly slots: Slot[] = [];
  /** Each part's `shown` as last filled in, in the slots' order: a change refills them. */
  private readonly shownLast: Uint8Array;
  private readonly allParts: TilePart[] = [];

  constructor(tiles: readonly Group[], parent: Object3D) {
    const byName = new Map<string, TilePart[]>();
    for (const tile of tiles) {
      for (const child of tile.children) {
        if (!(child instanceof InstancedMesh) || child.count === 0) {
          continue;
        }
        const detail = child.name === 'forest:shadows' || child.name === 'forest:trunks:inner';
        const parts = byName.get(child.name) ?? [];
        parts.push({ mesh: child, shown: detail ? child : tile, box: new Box3().setFromObject(child).expandByScalar(VIEW_MARGIN_METERS) });
        byName.set(child.name, parts);
      }
    }
    for (const [name, parts] of byName) {
      const first = parts[0]!.mesh;
      const capacity = parts.reduce((sum, part) => sum + part.mesh.count, 0);
      const batch = new InstancedMesh(first.geometry, first.material, capacity);
      batch.name = `${name}:batch`;
      if (first.instanceColor !== null) {
        batch.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      }
      batch.count = 0;
      batch.visible = false;
      // Its instances change with the view: bounds worked out once would go stale. The tiles are culled instead.
      batch.frustumCulled = false;
      batch.renderOrder = first.renderOrder;
      batch.castShadow = first.castShadow;
      batch.receiveShadow = first.receiveShadow;
      batch.matrixAutoUpdate = false;
      parent.add(batch);
      this.slots.push({ batch, parts });
      for (const part of parts) {
        this.allParts.push(part);
        // The tile's own mesh stays for its bounds and its flag; the batch draws it.
        part.mesh.layers.disableAll();
      }
    }
    this.shownLast = new Uint8Array(this.allParts.length).fill(2);
  }

  /** The batches, for tests and the scene's counts. */
  get batches(): readonly InstancedMesh[] {
    return this.slots.map((slot) => slot.batch);
  }

  /**
   * Fills the batches again if what is in view changed since the last call:
   * the tiles' and the details' `visible`, set by the culling this frame,
   * and, given the camera's `view`, whether each tile's mesh of a kind is in
   * it (the trees cast no shadow into the shadow map: one out of view is
   * never needed).
   * Allocation-free; a refill copies the tiles' instance data and uploads it.
   */
  update(view: Frustum | null = null): void {
    let changed = false;
    for (let i = 0; i < this.allParts.length; i++) {
      const part = this.allParts[i]!;
      // Its tile shown, the detail itself shown (for the crowns and trunks that is the tile again), and in view.
      const shown =
        part.mesh.parent?.visible !== false && part.shown.visible && (view === null || view.intersectsBox(part.box)) ? 1 : 0;
      if (this.shownLast[i] !== shown) {
        this.shownLast[i] = shown;
        changed = true;
      }
    }
    if (!changed) {
      return;
    }
    let index = 0;
    for (const slot of this.slots) {
      const { batch } = slot;
      const matrices = batch.instanceMatrix.array as Float32Array;
      const colors = batch.instanceColor?.array as Float32Array | undefined;
      let count = 0;
      for (const part of slot.parts) {
        if (this.shownLast[index++] === 0) {
          continue;
        }
        const n = part.mesh.count;
        matrices.set((part.mesh.instanceMatrix.array as Float32Array).subarray(0, n * 16), count * 16);
        if (colors !== undefined && part.mesh.instanceColor !== null) {
          colors.set((part.mesh.instanceColor.array as Float32Array).subarray(0, n * 3), count * 3);
        }
        count += n;
      }
      batch.count = count;
      batch.visible = count > 0;
      batch.instanceMatrix.clearUpdateRanges();
      batch.instanceMatrix.addUpdateRange(0, count * 16);
      batch.instanceMatrix.needsUpdate = true;
      if (batch.instanceColor !== null) {
        batch.instanceColor.clearUpdateRanges();
        batch.instanceColor.addUpdateRange(0, count * 3);
        batch.instanceColor.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    for (const slot of this.slots) {
      slot.batch.removeFromParent();
      // The geometry and material are the tiles' (TrackView disposes them); the batch's own buffers go with it.
      slot.batch.dispose();
    }
  }
}
