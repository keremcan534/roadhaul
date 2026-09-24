import { Vector3, type PerspectiveCamera } from 'three';
import { clamp, clamp01, dampFactor, finiteOr } from '../../core/math/scalar';
import { CAMERA_MODES, type CameraMode } from '../../data/config/controls';
import type { UpgradeLook } from '../../data/definitions/UpgradeDefinition';
import type { VehicleBody } from '../../data/definitions/VehicleDefinition';
import type { VehicleRuntimeState } from '../../domain/vehicles/VehicleRuntimeState';
import type { VehiclePose } from '../../systems/driving/DrivingService';
import { cabGeometry, type CabGeometry } from '../vehicles/cabGeometry';

export type { CameraMode } from '../../data/config/controls';

/** What the cameras read of the truck's motion besides its pose. */
export type CameraMotion = Pick<VehicleRuntimeState, 'speed' | 'steerAngle' | 'longitudinalAcceleration' | 'lateralAcceleration'>;

/** Behind the truck's middle: half its length plus this much (10.5 m for the H1). */
const CHASE_GAP_METERS = 6.8;
/** Extra distance per m/s of speed, so the truck does not fill the screen at speed. */
const CHASE_DISTANCE_PER_SPEED = 0.1;
/** Above the truck's roof: high enough to see the road over the cargo box (4.8 m for the H1). */
const CHASE_HEIGHT_ABOVE_ROOF_METERS = 1.5;
const CHASE_LOOK_AHEAD_METERS = 10;
const CHASE_LOOK_HEIGHT_METERS = 2.6;
/** Looking up or down (dragging) lowers or raises the chase camera this much per radian. */
const CHASE_HEIGHT_PER_PITCH = 6;
const FOLLOW_RATE = 6;
/** High above and a little behind, for parking: the whole yard in view. */
const TOP_HEIGHT_METERS = 28;
const TOP_BEHIND_METERS = 12;
const TOP_LOOK_AHEAD_METERS = 3;
/** The hood camera rides this high above the cab roof, this far behind its front edge: the roof's front shows at the bottom. */
const HOOD_ABOVE_ROOF_METERS = 0.4;
const HOOD_BEHIND_FRONT_METERS = 0.8;
/** The rear camera sits this far behind the body, this far under its top, looking this far down (radians). */
const REAR_BEHIND_METERS = 0.25;
const REAR_BELOW_TOP_METERS = 0.15;
const REAR_LOOK_DOWN = 0.45;
/** Where the driver looks at rest: a little below the horizon (radians). */
const CABIN_LOOK_DOWN = 0.05;
/** The driver looks into turns: this fraction of the front wheels' angle. */
const CABIN_TURN_LOOK = 0.4;
/** The driver's head sways: meters per m/s² of braking or cornering. */
const CABIN_SWAY_PER_ACCELERATION = 0.012;
const CABIN_SWAY_RATE = 4;
/** Far enough for the look direction; the target point is this far along it. */
const LOOK_DISTANCE_METERS = 30;
const FIELD_OF_VIEW: Readonly<Record<CameraMode, number>> = { chase: 60, cabin: 72, hood: 70, rear: 80, top: 55 };
/**
 * Looking ahead (chase, cabin, hood), the view widens by up to this many
 * degrees at speed, so the road seems to rush past: from the first speed
 * to the second, m/s (30 to 90 km/h), eased in and out at this rate.
 */
const SPEED_WIDENING_DEGREES = 6;
const SPEED_WIDENING_FROM = 8.3;
const SPEED_WIDENING_TO = 25;
const SPEED_WIDENING_RATE = 1.5;
/** How far each camera can be turned by dragging, radians either way (yaw, pitch). */
const LOOK_LIMITS: Readonly<Record<CameraMode, readonly [number, number]>> = {
  chase: [Math.PI, 0.35],
  cabin: [Math.PI * 0.6, 0.4],
  hood: [Math.PI * 0.5, 0.35],
  rear: [Math.PI * 0.35, 0.25],
  top: [Math.PI, 0],
};
/** Menus show the parked truck from a camera circling it slowly. */
const SHOWCASE_DISTANCE_METERS = 14;
/** Framed beside a panel (frameBeside), the showcase stands back this much more per share of the screen covered. */
const SHOWCASE_FRAMED_STEP_BACK = 0.45;
/** How fast the showcase swings round to a part it is asked to show (turnShowcaseTo), 1/s. */
const SHOWCASE_SWING_RATE = 2.5;

/**
 * Where the showcase looks at each upgraded part from, radians round the
 * truck (0 in front, π/2 its left): the exhaust stacks from the front right,
 * the rims, calipers and tank from the left, the lower stance and its
 * mudflaps from behind on the left.
 */
export const SHOWCASE_PART_ANGLES: Readonly<Record<UpgradeLook, number>> = {
  exhaust: -0.8,
  brakes: 1.2,
  wheels: 1.1,
  stance: 2.2,
  fuelTank: 1.35,
};
/** The side view that shows a new coat of paint: the cab and the livery's stripe. */
export const SHOWCASE_PAINT_ANGLE = 1.7;
const SHOWCASE_HEIGHT_METERS = 4.2;
const SHOWCASE_LOOK_HEIGHT_METERS = 1.8;
const SHOWCASE_TURN_RATE = 0.15;
const SHOWCASE_FOV = 60;

/**
 * The driving cameras (spec §31) and the menus' showcase camera:
 * - chase: trails the truck smoothly from behind and above;
 * - cabin: the driver's eye in the left seat (the map drives on the right),
 *   looking a little into turns, the head swaying with braking and cornering;
 * - hood: on the cab roof, looking ahead;
 * - rear: behind the body, looking down at the road behind, for reversing;
 * - top: high above, for parking.
 * `look()` turns any of them by the player's drag (LookAround). Behind the
 * menus, a showcase camera circles the parked truck; beside the company
 * panel it frames the truck in the part of the screen the panel leaves
 * free (frameBeside). Allocation-free per frame.
 */
export class CameraRig {
  private mode: CameraMode = 'chase';
  private cab: CabGeometry;
  private readonly position = new Vector3();
  private readonly target = new Vector3();
  private snapNextFrame = true;
  private showcaseEnabled = false;
  /** Radians around the truck, measured like headings (0 = in front of it along +Z). */
  private showcaseAngle = 2.4;
  /** Where the showcase is swinging round to (turnShowcaseTo); null while it just circles. */
  private showcaseSwing: number | null = null;
  /** The player's drag: radians to the right, and up. */
  private lookYaw = 0;
  private lookPitch = 0;
  /** The cabin camera's eased turn into bends (radians, right) and head sway (meters, left and ahead). */
  private turnLook = 0;
  private swayLeft = 0;
  private swayAhead = 0;
  /** How much wider the view is for the speed, degrees (eased). */
  private speedWidening = 0;
  /** The share of the screen a panel covers at the right and at the bottom (frameBeside). */
  private coveredRight = 0;
  private coveredBottom = 0;

  constructor(
    private readonly camera: PerspectiveCamera,
    private body: VehicleBody,
  ) {
    this.cab = cabGeometry(body);
    this.applyFieldOfView();
  }

  /** Follows another truck (the garage swapped it): a bigger one is watched from further back. */
  setBody(body: VehicleBody): void {
    this.body = body;
    this.cab = cabGeometry(body);
    this.snapNextFrame = true;
  }

  get currentMode(): CameraMode {
    return this.mode;
  }

  set currentMode(mode: CameraMode) {
    if (mode !== this.mode) {
      this.mode = mode;
      this.snapNextFrame = true;
      this.applyFieldOfView();
    }
  }

  /** The next camera of CAMERA_MODES, round to the first. */
  toggleMode(): CameraMode {
    this.currentMode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length]!;
    return this.mode;
  }

  /** How far the current camera turns by dragging, radians: to either side, and up or down. */
  get lookLimits(): readonly [number, number] {
    return LOOK_LIMITS[this.mode];
  }

  /** The player's drag this frame: radians to the right, and up. Kept within the camera's limits. */
  look(yaw: number, pitch: number): void {
    const [maxYaw, maxPitch] = LOOK_LIMITS[this.mode];
    this.lookYaw = clamp(yaw, -maxYaw, maxYaw);
    this.lookPitch = clamp(pitch, -maxPitch, maxPitch);
  }

  /** Whether the menus' circling camera is on. The driving mode is kept for when it goes off. */
  get showcase(): boolean {
    return this.showcaseEnabled;
  }

  set showcase(enabled: boolean) {
    if (enabled !== this.showcaseEnabled) {
      this.showcaseEnabled = enabled;
      this.snapNextFrame = true;
      this.applyFieldOfView();
    }
  }

  /**
   * Frames the picture in the part of the screen a panel leaves free: the
   * view shifts so what it looks at sits in the middle of it, and the
   * showcase stands back to fit the truck there. `coveredRight` and
   * `coveredBottom` are the shares of the screen's width and height the
   * panel covers; 0 and 0 give the whole screen back.
   */
  frameBeside(coveredRight: number, coveredBottom: number): void {
    const right = clamp01(finiteOr(coveredRight, 0));
    const bottom = clamp01(finiteOr(coveredBottom, 0));
    if (right === this.coveredRight && bottom === this.coveredBottom) {
      return;
    }
    this.coveredRight = right;
    this.coveredBottom = bottom;
    if (right === 0 && bottom === 0) {
      this.camera.clearViewOffset();
      return;
    }
    // The view slides by half the covered share: the free part's middle comes to the picture's middle. The
    // sizes are the camera's own shape (setViewOffset sets the aspect from them).
    const width = this.camera.aspect;
    this.camera.setViewOffset(width, 1, (width * right) / 2, bottom / 2, width, 1);
  }

  /**
   * Swings the showcase round to `angle` (radians round the truck, 0 in
   * front, π/2 its left: SHOWCASE_PART_ANGLES), then it circles on from there.
   */
  turnShowcaseTo(angle: number): void {
    this.showcaseSwing = Number.isFinite(angle) ? angle : null;
  }

  /** Follows the (interpolated) truck pose. */
  update(pose: Readonly<VehiclePose>, motion: Readonly<CameraMotion>, deltaSeconds: number): void {
    const sin = Math.sin(pose.heading);
    const cos = Math.cos(pose.heading);
    const cab = this.cab;
    const centreX = pose.x + sin * cab.centreZ;
    const centreZ = pose.z + cos * cab.centreZ;
    // The heading the camera looks along: the truck's, turned right by the drag.
    const view = pose.heading - this.lookYaw;
    const viewSin = Math.sin(view);
    const viewCos = Math.cos(view);

    if (this.showcaseEnabled) {
      if (this.showcaseSwing === null) {
        this.showcaseAngle = (this.showcaseAngle + SHOWCASE_TURN_RATE * deltaSeconds) % (2 * Math.PI);
      } else {
        // The short way round.
        const left = Math.atan2(Math.sin(this.showcaseSwing - this.showcaseAngle), Math.cos(this.showcaseSwing - this.showcaseAngle));
        this.showcaseAngle += left * dampFactor(SHOWCASE_SWING_RATE, deltaSeconds);
        if (Math.abs(left) < 0.01) {
          this.showcaseSwing = null;
        }
      }
      const around = pose.heading + this.showcaseAngle;
      const distance =
        SHOWCASE_DISTANCE_METERS * (1 + SHOWCASE_FRAMED_STEP_BACK * Math.max(this.coveredRight, this.coveredBottom));
      this.position.set(
        centreX + Math.sin(around) * distance,
        SHOWCASE_HEIGHT_METERS,
        centreZ + Math.cos(around) * distance,
      );
      this.target.set(centreX, SHOWCASE_LOOK_HEIGHT_METERS, centreZ);
    } else if (this.mode === 'chase' || this.mode === 'top') {
      // Both trail the truck, round which the drag swings them.
      let back: number;
      let height: number;
      let ahead: number;
      let lookHeight: number;
      if (this.mode === 'chase') {
        back = this.body.lengthMeters / 2 + CHASE_GAP_METERS + Math.abs(motion.speed) * CHASE_DISTANCE_PER_SPEED;
        height = Math.max(2, this.body.heightMeters + CHASE_HEIGHT_ABOVE_ROOF_METERS - this.lookPitch * CHASE_HEIGHT_PER_PITCH);
        ahead = CHASE_LOOK_AHEAD_METERS;
        lookHeight = CHASE_LOOK_HEIGHT_METERS;
      } else {
        back = TOP_BEHIND_METERS;
        height = TOP_HEIGHT_METERS;
        ahead = TOP_LOOK_AHEAD_METERS;
        lookHeight = 0;
      }
      const desiredX = centreX - viewSin * back;
      const desiredZ = centreZ - viewCos * back;
      const lookX = centreX + viewSin * ahead;
      const lookZ = centreZ + viewCos * ahead;
      if (this.snapNextFrame) {
        this.position.set(desiredX, height, desiredZ);
        this.target.set(lookX, lookHeight, lookZ);
      } else {
        const follow = dampFactor(FOLLOW_RATE, deltaSeconds);
        this.position.x += (desiredX - this.position.x) * follow;
        this.position.y += (height - this.position.y) * follow;
        this.position.z += (desiredZ - this.position.z) * follow;
        this.target.x += (lookX - this.target.x) * follow;
        this.target.y += (lookHeight - this.target.y) * follow;
        this.target.z += (lookZ - this.target.z) * follow;
      }
    } else if (this.mode === 'cabin') {
      // The head leans against the truck's acceleration, and the eyes go into the bend.
      const ease = this.snapNextFrame ? 1 : dampFactor(CABIN_SWAY_RATE, deltaSeconds);
      this.swayLeft += (-motion.lateralAcceleration * CABIN_SWAY_PER_ACCELERATION - this.swayLeft) * ease;
      this.swayAhead += (-motion.longitudinalAcceleration * CABIN_SWAY_PER_ACCELERATION - this.swayAhead) * ease;
      this.turnLook += (motion.steerAngle * CABIN_TURN_LOOK - this.turnLook) * ease;
      const left = cab.eyeX + this.swayLeft;
      const ahead = cab.eyeZ + this.swayAhead;
      this.position.set(pose.x + cos * left + sin * ahead, cab.eyeY, pose.z - sin * left + cos * ahead);
      this.lookAlong(view - this.turnLook, this.lookPitch - CABIN_LOOK_DOWN);
    } else if (this.mode === 'hood') {
      const ahead = cab.frontZ - HOOD_BEHIND_FRONT_METERS;
      this.position.set(pose.x + sin * ahead, cab.cabTop + HOOD_ABOVE_ROOF_METERS, pose.z + cos * ahead);
      this.lookAlong(view, this.lookPitch - CABIN_LOOK_DOWN);
    } else {
      const behind = cab.rearZ - REAR_BEHIND_METERS;
      this.position.set(pose.x + sin * behind, this.body.heightMeters - REAR_BELOW_TOP_METERS, pose.z + cos * behind);
      // Backwards. Its picture is shown mirrored, like a reversing camera's (RenderHost.mirrored): the truck's
      // right is on the screen's right, so a drag to the right turns it toward the truck's right.
      this.lookAlong(pose.heading + Math.PI + this.lookYaw, this.lookPitch - REAR_LOOK_DOWN);
    }
    this.widenForSpeed(motion.speed, deltaSeconds);
    this.snapNextFrame = false;
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.target);
  }

  /** Eases the view wider with speed, for the cameras looking ahead. Allocation-free. */
  private widenForSpeed(speed: number, deltaSeconds: number): void {
    const ahead = !this.showcaseEnabled && (this.mode === 'chase' || this.mode === 'cabin' || this.mode === 'hood');
    const share = clamp01((Math.abs(speed) - SPEED_WIDENING_FROM) / (SPEED_WIDENING_TO - SPEED_WIDENING_FROM));
    const widening = ahead ? SPEED_WIDENING_DEGREES * share * share * (3 - 2 * share) : 0;
    this.speedWidening = this.snapNextFrame
      ? widening
      : this.speedWidening + (widening - this.speedWidening) * dampFactor(SPEED_WIDENING_RATE, deltaSeconds);
    const fov = this.baseFieldOfView() + this.speedWidening;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Aims from the camera's position along a heading (radians), tipped up by `elevation` (radians). */
  private lookAlong(heading: number, elevation: number): void {
    const flat = Math.cos(elevation) * LOOK_DISTANCE_METERS;
    this.target.set(
      this.position.x + Math.sin(heading) * flat,
      this.position.y + Math.sin(elevation) * LOOK_DISTANCE_METERS,
      this.position.z + Math.cos(heading) * flat,
    );
  }

  private baseFieldOfView(): number {
    return this.showcaseEnabled ? SHOWCASE_FOV : FIELD_OF_VIEW[this.mode];
  }

  private applyFieldOfView(): void {
    this.speedWidening = 0;
    this.camera.fov = this.baseFieldOfView();
    this.camera.updateProjectionMatrix();
  }
}
