import {
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import type { DebrisSimulation } from '../../domain/crash/DebrisSimulation';

/**
 * Where a body of debris is drawn: its geometry's origin (the thing's foot)
 * `footY` below the body's middle and `footZ` behind it, in the body's own
 * frame, `alpha` of the way from its pose before the last fixed step to its
 * pose now, scaled about its foot. Allocation-free.
 */
export class DebrisPose {
  /** The last pose's turn (matrixOf). */
  readonly turn = new Quaternion();
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly before = new Quaternion();
  private readonly after = new Quaternion();
  private readonly foot = new Vector3();
  private readonly scale = new Vector3(1, 1, 1);

  /** Body `slot`'s matrix; kept until the next call. */
  matrixOf(
    debris: DebrisSimulation,
    slot: number,
    alpha: number,
    footY: number,
    footZ = 0,
    scaleX = 1,
    scaleY = 1,
    scaleZ = 1,
  ): Matrix4 {
    const keep = 1 - alpha;
    this.position.set(
      debris.previousX[slot]! * keep + debris.x[slot]! * alpha,
      debris.previousY[slot]! * keep + debris.y[slot]! * alpha,
      debris.previousZ[slot]! * keep + debris.z[slot]! * alpha,
    );
    this.before.set(debris.previousQx[slot]!, debris.previousQy[slot]!, debris.previousQz[slot]!, debris.previousQw[slot]!);
    this.after.set(debris.qx[slot]!, debris.qy[slot]!, debris.qz[slot]!, debris.qw[slot]!);
    this.turn.slerpQuaternions(this.before, this.after, alpha);
    // The foot, turned with the body, from its middle.
    this.foot.set(0, -footY * scaleY, -footZ * scaleZ).applyQuaternion(this.turn);
    this.scale.set(scaleX, scaleY, scaleZ);
    return this.matrix.compose(this.position.add(this.foot), this.turn, this.scale);
  }
}

/**
 * Copies of one thing's geometry for its debris tumbling about (CrashService):
 * each drawn where its body is, `alpha` of the way from its pose before the
 * last fixed step to its pose now, its geometry's origin (the thing's foot)
 * `footY` below the body's middle and `footZ` behind it, in the body's own
 * frame. One draw call while any is about, none otherwise. Per frame:
 * begin(), add() for each body to draw, end(). Allocation-free.
 */
export class DebrisInstances {
  readonly mesh: InstancedMesh;
  private readonly pose = new DebrisPose();
  private count = 0;

  constructor(
    parent: Object3D,
    geometry: BufferGeometry,
    material: Material,
    capacity: number,
    private readonly footY: number,
    private readonly footZ = 0,
    name = 'debris',
  ) {
    this.mesh = new InstancedMesh(geometry, material, Math.max(1, capacity));
    this.mesh.name = name;
    this.mesh.count = 0;
    this.mesh.visible = false;
    // The bodies fly about the whole map: bounds computed once would go stale.
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
  }

  /** Starts a frame: nothing drawn yet. */
  begin(): void {
    this.count = 0;
  }

  /**
   * Draws body `slot` of `debris`, `alpha` (0..1) of the way from its last
   * pose to its current one, scaled by (`scaleX`, `scaleY`, `scaleZ`) about
   * its foot. Returns the instance, or -1 when there is no room left.
   */
  add(debris: DebrisSimulation, slot: number, alpha: number, scaleX = 1, scaleY = 1, scaleZ = 1): number {
    if (this.count >= this.mesh.instanceMatrix.count) {
      return -1;
    }
    const instance = this.count++;
    this.mesh.setMatrixAt(instance, this.pose.matrixOf(debris, slot, alpha, this.footY, this.footZ, scaleX, scaleY, scaleZ));
    return instance;
  }

  /** Ends the frame: shows what was added, and nothing when nothing was. */
  end(): void {
    this.mesh.count = this.count;
    this.mesh.visible = this.count > 0;
    if (this.count > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
  }
}
