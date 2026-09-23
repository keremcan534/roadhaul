import {
  BoxGeometry,
  CylinderGeometry,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import { clamp, dampFactor } from '../../core/math/scalar';
import type { VehicleDefinition } from '../../data/definitions/VehicleDefinition';
import type { VehicleRuntimeState } from '../../domain/vehicles/VehicleRuntimeState';
import type { VehiclePose } from '../../systems/driving/DrivingService';

const CAB_COLOR = 0xe0622a;
const WINDSHIELD_COLOR = 0x2d3a48;
const CARGO_BOX_COLOR = 0xe9e5dc;
const CHASSIS_COLOR = 0x2c2f33;
const TIRE_COLOR = 0x1c1c1c;
const TAIL_LIGHT_COLOR = 0xd4261c;
const DASHBOARD_COLOR = 0x23272c;
const CAB_LENGTH_METERS = 2.1;

/** Body lean per m/s² of acceleration (radians), capped, and how fast the lean follows. */
const PITCH_PER_ACCELERATION = 0.008;
const ROLL_PER_ACCELERATION = 0.012;
const MAX_LEAN = 0.07;
const LEAN_RESPONSE_RATE = 5;

/**
 * A generic box truck built from a VehicleDefinition's body dimensions:
 * original shapes, no real-world model. Its origin is the rear axle, like
 * VehicleRuntimeState. Front wheels steer, all wheels roll, and the body
 * pitches and rolls with acceleration.
 *
 * update() runs every frame and allocates nothing.
 */
export class TruckView {
  private readonly root = new Group();
  private readonly body = new Group();
  private readonly windshield: Mesh;
  /** Only shown from the driver's seat. */
  private readonly dashboard: Mesh;
  private readonly wheels: InstancedMesh;
  private readonly resources: { dispose(): void }[] = [];
  private readonly wheelPositions: readonly (readonly [number, number, number])[];
  private wheelSpin = 0;
  private pitch = 0;
  private roll = 0;
  // Scratch objects reused every frame.
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private readonly unitScale = new Vector3(1, 1, 1);

  constructor(
    private readonly scene: Scene,
    private readonly definition: VehicleDefinition,
  ) {
    const { lengthMeters, widthMeters, heightMeters, wheelbaseMeters, wheelRadiusMeters } = definition.body;
    const centreZ = wheelbaseMeters / 2;
    const frontZ = centreZ + lengthMeters / 2;
    const frameY = wheelRadiusMeters + 0.1;
    const deckY = frameY + 0.25;
    const cabHeight = (heightMeters - deckY) * 0.75;
    const boxLength = lengthMeters - CAB_LENGTH_METERS - 0.25;
    const rearZ = centreZ - lengthMeters / 2;

    this.windshield = this.box(
      [widthMeters * 0.86, cabHeight * 0.38, 0.05],
      [0, deckY + cabHeight * 0.68, frontZ + 0.01],
      WINDSHIELD_COLOR,
    );
    // A dashboard along the bottom of the windscreen, seen only in cabin view (see CameraRig's eye position).
    // It does not lean with the body: neither does the driver's eye, and it would bob up and down the screen.
    this.dashboard = this.box(
      [widthMeters * 0.9, 0.3, 0.7],
      [0, heightMeters * 0.72 - 0.45, frontZ - 0.45],
      DASHBOARD_COLOR,
    );
    this.dashboard.visible = false;
    const tailLightSize = [0.32, 0.18, 0.06] as const;
    const tailLightX = widthMeters / 2 - 0.3;
    this.body.add(
      this.box([widthMeters * 0.85, 0.3, lengthMeters * 0.96], [0, frameY, centreZ], CHASSIS_COLOR),
      this.box([widthMeters, cabHeight, CAB_LENGTH_METERS], [0, deckY + cabHeight / 2, frontZ - CAB_LENGTH_METERS / 2], CAB_COLOR),
      this.windshield,
      this.box(
        [widthMeters + 0.04, heightMeters - deckY, boxLength],
        [0, deckY + (heightMeters - deckY) / 2, frontZ - CAB_LENGTH_METERS - 0.25 - boxLength / 2],
        CARGO_BOX_COLOR,
      ),
      // Rear: bumper, the seam between the two doors, and tail lights, so the truck reads as one from behind.
      this.box([widthMeters * 0.95, 0.22, 0.12], [0, frameY - 0.05, rearZ - 0.02], CHASSIS_COLOR),
      this.box([0.05, heightMeters - deckY - 0.2, 0.02], [0, deckY + (heightMeters - deckY) / 2, rearZ - 0.02], CHASSIS_COLOR),
      this.box(tailLightSize, [tailLightX, deckY + 0.3, rearZ - 0.04], TAIL_LIGHT_COLOR, true),
      this.box(tailLightSize, [-tailLightX, deckY + 0.3, rearZ - 0.04], TAIL_LIGHT_COLOR, true),
    );

    const tire = this.track(new CylinderGeometry(wheelRadiusMeters, wheelRadiusMeters, 0.4, 14));
    tire.rotateZ(Math.PI / 2); // Axle along X.
    const trackHalf = widthMeters / 2 - 0.25;
    this.wheelPositions = [
      [trackHalf, wheelRadiusMeters, wheelbaseMeters],
      [-trackHalf, wheelRadiusMeters, wheelbaseMeters],
      [trackHalf, wheelRadiusMeters, 0],
      [-trackHalf, wheelRadiusMeters, 0],
    ];
    this.wheels = this.track(new InstancedMesh(tire, this.material(TIRE_COLOR), this.wheelPositions.length));
    this.updateWheels(0);

    this.root.add(this.body, this.dashboard, this.wheels);
    scene.add(this.root);
  }

  /** Places the truck at `pose` (interpolated between fixed steps) and animates wheels and body lean. */
  update(pose: Readonly<VehiclePose>, state: Readonly<VehicleRuntimeState>, deltaSeconds: number): void {
    this.root.position.set(pose.x, 0, pose.z);
    this.root.rotation.y = pose.heading;

    this.wheelSpin += (state.speed * deltaSeconds) / this.definition.body.wheelRadiusMeters;
    this.updateWheels(state.steerAngle);

    // Nose dips when braking and lifts when accelerating; the body leans out of turns.
    const response = dampFactor(LEAN_RESPONSE_RATE, deltaSeconds);
    const targetPitch = clamp(-state.longitudinalAcceleration * PITCH_PER_ACCELERATION, -MAX_LEAN, MAX_LEAN);
    const targetRoll = clamp(state.lateralAcceleration * ROLL_PER_ACCELERATION, -MAX_LEAN, MAX_LEAN);
    this.pitch += (targetPitch - this.pitch) * response;
    this.roll += (targetRoll - this.roll) * response;
    this.body.rotation.set(this.pitch, 0, this.roll);
  }

  /** From the driver's seat the windshield would block the view: swap it for the dashboard. */
  setCabinView(enabled: boolean): void {
    this.windshield.visible = !enabled;
    this.dashboard.visible = enabled;
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const resource of this.resources) {
      resource.dispose();
    }
  }

  private updateWheels(steerAngle: number): void {
    for (let i = 0; i < this.wheelPositions.length; i++) {
      const [x, y, z] = this.wheelPositions[i]!;
      // Positive steering turns right, which is a negative rotation about Y.
      const steer = i < 2 ? -steerAngle : 0;
      this.rotation.setFromEuler(this.euler.set(this.wheelSpin, steer, 0));
      this.position.set(x, y, z);
      this.wheels.setMatrixAt(i, this.matrix.compose(this.position, this.rotation, this.unitScale));
    }
    this.wheels.instanceMatrix.needsUpdate = true;
  }

  private box(
    size: readonly [number, number, number],
    position: readonly [number, number, number],
    color: number,
    glowing = false,
  ): Mesh {
    const mesh = new Mesh(this.track(new BoxGeometry(...size)), this.material(color, glowing));
    mesh.position.set(...position);
    return mesh;
  }

  /** `glowing` materials light themselves (lamps), independent of the scene lighting. */
  private material(color: number, glowing = false): MeshLambertMaterial {
    return this.track(new MeshLambertMaterial({ color, emissive: glowing ? color : 0x000000 }));
  }

  private track<T extends { dispose(): void }>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }
}
