import { DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, Vector3, type Scene } from 'three';
import { personGeometry, personMaterial } from '../world/PedestrianView';

/** The driver's look among the people's: a mustard work shirt and navy trousers (the palettes' picks for it). */
const DRIVER_LOOK = 0.083;

/**
 * The driver on foot (OnFootService): one of the towns' people, dressed
 * for work, walking with their stride, an umbrella up in the rain. One draw
 * call, hidden (none) while the driver is in the cab.
 */
export class DriverFigureView {
  private readonly mesh: InstancedMesh;
  private readonly person: InstancedBufferAttribute;
  private readonly uniforms = { time: { value: 0 }, umbrella: { value: 0 } };
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly scale = new Vector3(1, 1, 1);
  private readonly up = new Vector3(0, 1, 0);

  constructor(private readonly scene: Scene) {
    const geometry = personGeometry();
    this.person = new InstancedBufferAttribute(new Float32Array(3), 3).setUsage(DynamicDrawUsage);
    geometry.setAttribute('person', this.person);
    this.mesh = new InstancedMesh(geometry, personMaterial(this.uniforms), 1);
    this.mesh.name = 'driver-on-foot';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    scene.add(this.mesh);
  }

  /** Whether the driver is drawn. */
  get shown(): boolean {
    return this.mesh.visible;
  }

  /**
   * Shown (or not) standing at (x, y, z) facing `heading`, the stride
   * `cycle` along, `walking` (0 standing to 1 walking), the umbrella
   * `umbrella` open. Allocation-free.
   */
  update(visible: boolean, x: number, y: number, z: number, heading: number, cycle: number, walking: number, umbrella: number): void {
    this.mesh.visible = visible;
    if (!visible) {
      return;
    }
    this.position.set(x, y, z);
    this.rotation.setFromAxisAngle(this.up, heading);
    this.mesh.setMatrixAt(0, this.matrix.compose(this.position, this.rotation, this.scale));
    this.mesh.instanceMatrix.needsUpdate = true;
    const person = this.person.array as Float32Array;
    person[0] = cycle;
    person[1] = walking;
    person[2] = DRIVER_LOOK;
    this.person.needsUpdate = true;
    this.uniforms.umbrella.value = umbrella;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as { dispose(): void }).dispose();
    this.mesh.dispose();
  }
}
