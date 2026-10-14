import { InstancedMesh } from 'three';

/**
 * Where the sun's real-time shadows reach (EnvironmentView, the high preset): a square round the truck, so a caster
 * far off draws into the shadow map for nothing. The views whose casters are spread over the whole map in one
 * instanced mesh ask it which of them to draw there (ShadowSubset).
 */
export interface ShadowReach {
  /**
   * Changes whenever the shadows' square has moved or turned far enough that casters standing still are gathered
   * again: until it changes, those gathered with a margin of SHADOW_GATHER_MARGIN_METERS still cover it.
   */
  readonly shadowStamp: number;
  /**
   * Whether something standing at (`x`, `z`), `heightMeters` tall, can cast into the shadows' square grown by
   * `marginMeters` on every side. False without shadows. Allocation-free.
   */
  shadowReaches(x: number, z: number, heightMeters: number, marginMeters: number): boolean;
}

/** The margin casters standing still are gathered with (ShadowReach.shadowStamp): twice the move that changes it. */
export const SHADOW_GATHER_MARGIN_METERS = 10;

const FLOATS_PER_MATRIX = 16;

/**
 * The instances of a mesh spread over the map (street lamps, grazers, traffic) that cast into the shadow map: a
 * second instanced mesh on the source's geometry and material that is drawn into the shadow map only. In the colour
 * pass it holds no instances, and an instanced draw of none is skipped; while the shadow map is drawn
 * (onBeforeShadow) it holds those gathered (begin, copy, end). The source then casts nothing itself. Without it every
 * lamp post, grazer or vehicle on the map was drawn into the shadow map each frame, for the few near the truck.
 */
export class ShadowSubset {
  readonly mesh: InstancedMesh;
  private filled = 0;
  private gathered = 0;

  constructor(
    private readonly source: InstancedMesh,
    private readonly capacity: number,
  ) {
    const mesh = new InstancedMesh(source.geometry, source.material, Math.max(1, capacity));
    mesh.name = `${source.name}:shadow`;
    // The source's colours, though they never show: the same shader as the source's, not one more to compile.
    mesh.instanceColor = source.instanceColor;
    mesh.count = 0;
    mesh.castShadow = true;
    // The instances gathered are near the truck, but the mesh's own bounds know nothing of them.
    mesh.frustumCulled = false;
    mesh.onBeforeShadow = () => {
      mesh.count = this.gathered;
    };
    mesh.onAfterShadow = () => {
      mesh.count = 0;
    };
    source.castShadow = false;
    this.mesh = mesh;
  }

  /** How many instances were last gathered. */
  get count(): number {
    return this.gathered;
  }

  begin(): void {
    this.filled = 0;
  }

  /** The source's instance `index`, as it stands now, into the shadow map; past the capacity, nothing. */
  copy(index: number): void {
    if (this.filled >= this.capacity) {
      return;
    }
    const from = this.source.instanceMatrix.array;
    const to = this.mesh.instanceMatrix.array;
    const read = index * FLOATS_PER_MATRIX;
    const write = this.filled * FLOATS_PER_MATRIX;
    for (let k = 0; k < FLOATS_PER_MATRIX; k++) {
      to[write + k] = from[read + k]!;
    }
    this.filled++;
  }

  /** Sends the instances gathered since begin (only those) to the GPU. */
  end(): void {
    this.gathered = this.filled;
    const matrices = this.mesh.instanceMatrix;
    matrices.clearUpdateRanges();
    if (this.filled > 0) {
      matrices.addUpdateRange(0, this.filled * FLOATS_PER_MATRIX);
      matrices.needsUpdate = true;
    }
  }

  dispose(): void {
    // The colours are the source's: its own to free.
    this.mesh.instanceColor = null;
    this.mesh.dispose();
  }
}
