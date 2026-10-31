import { InstancedBufferAttribute, InstancedMesh } from 'three';
import { FAR_CULL_METERS } from './worldTiles';

const FLOATS_PER_MATRIX = 16;
/** The instances near the camera are gathered again once it has moved this far, meters. */
const GATHER_STEP_METERS = 50;

/**
 * The instances of a mesh spread over the whole map (the street lamps, the
 * hay bales) that are near the camera, drawn in place of the source: a
 * second instanced mesh on the source's geometry and material, holding
 * copies of those within `reach` of the camera, gathered again each time it
 * has moved GATHER_STEP_METERS or the source changed (refresh). The source
 * keeps every instance (knocked over, hidden, cast into shadows: its own
 * business) and stays out of the scene; this mesh takes its name. One draw
 * call as before, for the instances that can be seen: past the reach they
 * are deep in the haze.
 */
export class NearInstances {
  readonly mesh: InstancedMesh;
  /** Each instance's place on the ground: x, z. */
  private readonly places: Float32Array;
  private readonly reachSquared: number;
  private gatheredX = Number.NaN;
  private gatheredZ = Number.NaN;

  constructor(
    private readonly source: InstancedMesh,
    reachMeters = FAR_CULL_METERS + GATHER_STEP_METERS,
  ) {
    this.reachSquared = reachMeters * reachMeters;
    const count = source.count;
    this.places = new Float32Array(count * 2);
    const matrices = source.instanceMatrix.array;
    for (let i = 0; i < count; i++) {
      this.places[i * 2] = matrices[i * FLOATS_PER_MATRIX + 12]!;
      this.places[i * 2 + 1] = matrices[i * FLOATS_PER_MATRIX + 14]!;
    }
    const mesh = new InstancedMesh(source.geometry, source.material, Math.max(1, count));
    mesh.name = source.name;
    source.name = `${source.name}:all`;
    // Its own colours, copied with the matrices: each instance's slot is not the source's.
    if (source.instanceColor !== null) {
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(Math.max(1, count) * 3), 3);
    }
    // Into the shadow map as the source was (a ShadowSubset, made first, has taken that over from it already).
    mesh.castShadow = source.castShadow;
    mesh.receiveShadow = source.receiveShadow;
    mesh.count = 0;
    // The instances gathered move with the camera; the mesh's own bounds know nothing of them.
    mesh.frustumCulled = false;
    this.mesh = mesh;
  }

  /** Releases the mesh's instance buffers (the geometry and material are the source's). */
  dispose(): void {
    this.mesh.dispose();
  }

  /** How many instances are drawn now. */
  get count(): number {
    return this.mesh.count;
  }

  /** Gathers the instances near (x, z), the camera, once it has moved far enough. Allocation-free: call it every frame. */
  showAround(x: number, z: number): void {
    const dx = x - this.gatheredX;
    const dz = z - this.gatheredZ;
    if (dx * dx + dz * dz < GATHER_STEP_METERS * GATHER_STEP_METERS) {
      return;
    }
    this.gather(x, z);
  }

  /** Copies the source's instances again (some changed: knocked over, stood up), round where they were last gathered. */
  refresh(): void {
    if (!Number.isNaN(this.gatheredX)) {
      this.gather(this.gatheredX, this.gatheredZ);
    }
  }

  private gather(x: number, z: number): void {
    this.gatheredX = x;
    this.gatheredZ = z;
    const from = this.source.instanceMatrix.array;
    const to = this.mesh.instanceMatrix.array;
    const fromColors = this.source.instanceColor?.array ?? null;
    const toColors = this.mesh.instanceColor?.array ?? null;
    const places = this.places;
    let filled = 0;
    for (let i = 0; i < places.length / 2; i++) {
      const dx = places[i * 2]! - x;
      const dz = places[i * 2 + 1]! - z;
      if (dx * dx + dz * dz > this.reachSquared) {
        continue;
      }
      const read = i * FLOATS_PER_MATRIX;
      const write = filled * FLOATS_PER_MATRIX;
      for (let k = 0; k < FLOATS_PER_MATRIX; k++) {
        to[write + k] = from[read + k]!;
      }
      if (fromColors !== null && toColors !== null) {
        toColors[filled * 3] = fromColors[i * 3]!;
        toColors[filled * 3 + 1] = fromColors[i * 3 + 1]!;
        toColors[filled * 3 + 2] = fromColors[i * 3 + 2]!;
      }
      filled++;
    }
    this.mesh.count = filled;
    const matrices = this.mesh.instanceMatrix;
    matrices.clearUpdateRanges();
    if (filled > 0) {
      matrices.addUpdateRange(0, filled * FLOATS_PER_MATRIX);
      matrices.needsUpdate = true;
      const colors = this.mesh.instanceColor;
      if (colors !== null) {
        colors.clearUpdateRanges();
        colors.addUpdateRange(0, filled * 3);
        colors.needsUpdate = true;
      }
    }
  }
}
