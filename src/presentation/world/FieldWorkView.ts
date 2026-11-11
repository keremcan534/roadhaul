import {
  BoxGeometry,
  BufferAttribute,
  Color,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  type BufferGeometry,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Field } from '../../domain/world/DrivingWorld';
import { createTractorPose, tractorAt, type FieldWork } from '../../domain/world/fieldWork';

/** At most this many tractors are drawn at once: the nearest within REACH_METERS of the camera. */
const MOST_DRAWN = 6;
const REACH_METERS = 900;
/** The nearest are gathered again once the camera has moved this far, meters. */
const GATHER_STEP_METERS = 60;
/** Tractors are painted these colours, by turns (sRGB). */
const PAINTS: readonly Color[] = [0xb8322a, 0x2f7a3a, 0x2b5d9a, 0xd8a12a, 0x9a9a95].map((hex) => new Color(hex));
const TYRE = 0x262626;
const GLASS = 0x2f3d45;
const STEEL = 0x55595c;
/** A part painted the tractor's own colour (white, so the paint shows as it is). */
const BODY = 0xffffff;

function painted(geometry: BufferGeometry, hex: number): BufferGeometry {
  const color = new Color(hex);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

/** A farm tractor facing +z, its middle at the ground: bonnet and cab in its paint, big rear wheels, a plough behind. */
function tractorGeometry(): BufferGeometry {
  const wheel = (radius: number, width: number, x: number, z: number): BufferGeometry =>
    painted(new CylinderGeometry(radius, radius, width, 12).rotateZ(Math.PI / 2).translate(x, radius, z), TYRE);
  const parts = [
    painted(new BoxGeometry(1.0, 0.7, 2.4).translate(0, 1.05, 0.35), BODY),
    painted(new BoxGeometry(0.9, 0.6, 1.3).translate(0, 1.5, 0.95), BODY),
    painted(new BoxGeometry(1.25, 1.25, 1.2).translate(0, 2.0, -0.65), GLASS),
    painted(new BoxGeometry(1.4, 0.12, 1.4).translate(0, 2.68, -0.65), BODY),
    painted(new CylinderGeometry(0.06, 0.06, 1.1, 6).translate(0.3, 2.3, 1.25), STEEL),
    wheel(0.78, 0.5, -0.95, -0.65),
    wheel(0.78, 0.5, 0.95, -0.65),
    wheel(0.45, 0.3, -0.7, 1.15),
    wheel(0.45, 0.3, 0.7, 1.15),
    // The plough on its frame behind.
    painted(new BoxGeometry(2.2, 0.25, 0.3).translate(0, 0.65, -1.75), STEEL),
    painted(new BoxGeometry(0.25, 0.5, 1.4).translate(-0.7, 0.35, -2.4), STEEL),
    painted(new BoxGeometry(0.25, 0.5, 1.4).translate(0.7, 0.35, -2.4), STEEL),
  ];
  const geometry = mergeGeometries(parts);
  for (const part of parts) {
    part.dispose();
  }
  return geometry;
}

/**
 * The tractors at work in the fields (fieldWork.ts): the nearest of them to
 * the camera, up to MOST_DRAWN, drawn where the time puts them, going up and
 * down their fields. By day only, and not in the rain or the winter (show).
 * One draw call. update() allocates nothing.
 */
export class FieldWorkView {
  readonly mesh: InstancedMesh;
  private readonly geometry: BufferGeometry;
  private readonly material: MeshLambertMaterial;
  private readonly pose = createTractorPose();
  private readonly matrix = new Matrix4();
  /** The works drawn (indices into `works`), the nearest first, as last gathered. */
  private readonly drawn = new Int32Array(MOST_DRAWN);
  private drawnCount = 0;
  private readonly distances: Float64Array;
  private gatheredX = Number.NaN;
  private gatheredZ = Number.NaN;
  private time = 0;

  constructor(
    private readonly scene: Scene,
    private readonly fields: readonly Field[],
    private readonly works: readonly FieldWork[],
    castShadows = false,
  ) {
    this.geometry = tractorGeometry();
    this.material = new MeshLambertMaterial({ vertexColors: true });
    this.mesh = new InstancedMesh(this.geometry, this.material, MOST_DRAWN);
    this.mesh.name = 'tractors';
    this.mesh.count = 0;
    // The tractors move over the whole map: the mesh's own bounds know nothing of them.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = castShadows;
    for (let i = 0; i < MOST_DRAWN; i++) {
      this.mesh.setColorAt(i, PAINTS[0]!);
    }
    this.distances = new Float64Array(works.length);
    scene.add(this.mesh);
  }

  /**
   * Moves the tractors `deltaSeconds` on and draws the nearest to (x, z),
   * the camera, where they are now; `working` false (night, rain, winter)
   * hides them. Allocation-free.
   */
  update(deltaSeconds: number, x: number, z: number, working: boolean): void {
    this.time += deltaSeconds;
    this.mesh.visible = working && this.works.length > 0;
    if (!this.mesh.visible) {
      return;
    }
    const dx = x - this.gatheredX;
    const dz = z - this.gatheredZ;
    if (!(dx * dx + dz * dz < GATHER_STEP_METERS * GATHER_STEP_METERS)) {
      this.gather(x, z);
    }
    for (let i = 0; i < this.drawnCount; i++) {
      const work = this.works[this.drawn[i]!]!;
      tractorAt(this.fields[work.field]!, work, this.time, this.pose);
      this.mesh.setMatrixAt(i, this.matrix.makeRotationY(this.pose.heading).setPosition(this.pose.x, 0, this.pose.z));
    }
    this.mesh.count = this.drawnCount;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }

  /** The nearest works within reach of (x, z), nearest first, and their paints. */
  private gather(x: number, z: number): void {
    this.gatheredX = x;
    this.gatheredZ = z;
    const reach = REACH_METERS * REACH_METERS;
    let count = 0;
    for (let i = 0; i < this.works.length; i++) {
      const area = this.fields[this.works[i]!.field]!.area;
      const d = (area.x - x) * (area.x - x) + (area.z - z) * (area.z - z);
      this.distances[i] = d;
      if (d > reach) {
        continue;
      }
      // Into the nearest so far, kept in order (few: an insertion).
      let at = Math.min(count, MOST_DRAWN - 1);
      if (count === MOST_DRAWN && d >= this.distances[this.drawn[at]!]!) {
        continue;
      }
      while (at > 0 && this.distances[this.drawn[at - 1]!]! > d) {
        this.drawn[at] = this.drawn[at - 1]!;
        at--;
      }
      this.drawn[at] = i;
      count = Math.min(MOST_DRAWN, count + 1);
    }
    this.drawnCount = count;
    // Each work's tractor its own paint, whichever slot it is drawn in.
    for (let i = 0; i < count; i++) {
      this.mesh.setColorAt(i, PAINTS[this.drawn[i]! % PAINTS.length]!);
    }
    if (this.mesh.instanceColor !== null) {
      this.mesh.instanceColor.needsUpdate = true;
    }
  }
}
