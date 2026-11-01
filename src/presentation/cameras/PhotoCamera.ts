import { Vector3, type PerspectiveCamera } from 'three';
import { clamp, finiteOr } from '../../core/math/scalar';
import type { VehicleBody } from '../../data/definitions/VehicleDefinition';
import type { VehiclePose } from '../../systems/driving/DrivingService';

/** The photo camera's lens: a little longer than the chase camera's, flattering for a truck. */
export const PHOTO_FIELD_OF_VIEW = 50;
/** It looks at the truck's middle this high up, a little under half a truck's height. */
const AIM_HEIGHT_METERS = 1.8;
/** Never lower than this over the (flat) ground: low shots up at the truck, not under the road. */
const GROUND_CLEARANCE_METERS = 0.35;
/** Highest it looks down: almost straight down onto the roof. */
const MAX_PITCH = 1.35;
/** How near and how far it may stand from the truck's middle, beyond half the truck's length. */
const NEAREST_BEYOND_BODY_METERS = 1.5;
const FARTHEST_METERS = 45;
/** Turning by dragging: radians per pixel dragged (a full swipe across a phone is about a half turn). */
const RADIANS_PER_PIXEL = 0.006;
/** Opened from the cabin or hood camera (inside or on the truck), it starts here instead: behind, a little to the side. */
const FALLBACK_DISTANCE_METERS = 16;
const FALLBACK_PITCH = 0.2;
const FALLBACK_YAW_OFF_BEHIND = 0.6;

/**
 * Photo mode's camera (PhotoMode): it circles the parked truck, turned by a
 * drag (round it and up over it), brought nearer or farther by a pinch or the
 * wheel, always looking at the truck's middle, never under the ground. It
 * takes over from wherever the driving camera was, so the picture does not
 * jump. Allocation-free once made.
 */
export class PhotoCamera {
  private yaw = 0;
  private pitch = FALLBACK_PITCH;
  private distance = FALLBACK_DISTANCE_METERS;
  /** Half the truck's length plus a margin, and its middle along it (from the pose's point). */
  private nearest = 0;
  private centreZ = 0;
  private readonly aim = new Vector3();

  constructor(body: VehicleBody) {
    this.setBody(body);
  }

  /** Another truck: its size sets how near the camera may come. */
  setBody(body: VehicleBody): void {
    this.nearest = body.lengthMeters / 2 + NEAREST_BEYOND_BODY_METERS;
    this.centreZ = body.wheelbaseMeters / 2;
    this.distance = clamp(this.distance, this.nearest, FARTHEST_METERS);
  }

  /**
   * Starts from where `camera` stands now, round the truck at `pose`: the same
   * view, from then on turned round the truck's middle. From inside the cab or
   * over the hood it steps out behind the truck, a little to its side.
   */
  start(camera: PerspectiveCamera, pose: Readonly<VehiclePose>): void {
    this.aimAt(pose);
    const dx = camera.position.x - this.aim.x;
    const dy = camera.position.y - this.aim.y;
    const dz = camera.position.z - this.aim.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance < this.nearest) {
      this.yaw = pose.heading + Math.PI - FALLBACK_YAW_OFF_BEHIND;
      this.pitch = FALLBACK_PITCH;
      this.distance = FALLBACK_DISTANCE_METERS;
    } else {
      this.yaw = Math.atan2(dx, dz);
      this.pitch = Math.asin(clamp(dy / distance, -1, 1));
      this.distance = Math.min(distance, FARTHEST_METERS);
    }
    this.keepAboveGround();
  }

  /** A drag of `dxPixels` to the right and `dyPixels` down: round the truck the drag's way, and up over it dragging down. */
  orbit(dxPixels: number, dyPixels: number): void {
    this.yaw -= finiteOr(dxPixels, 0) * RADIANS_PER_PIXEL;
    this.pitch += finiteOr(dyPixels, 0) * RADIANS_PER_PIXEL;
    this.keepAboveGround();
  }

  /** Nearer (`factor` under 1) or farther (over 1), as a pinch or the wheel asks. */
  zoom(factor: number): void {
    if (!(factor > 0) || !Number.isFinite(factor)) {
      return;
    }
    this.distance = clamp(this.distance * factor, this.nearest, FARTHEST_METERS);
    this.keepAboveGround();
  }

  /** Places `camera` for the truck at `pose`: round its middle, looking at it, the lens straight. */
  apply(camera: PerspectiveCamera, pose: Readonly<VehiclePose>): void {
    this.aimAt(pose);
    const flat = Math.cos(this.pitch) * this.distance;
    camera.up.set(0, 1, 0);
    camera.position.set(
      this.aim.x + Math.sin(this.yaw) * flat,
      this.aim.y + Math.sin(this.pitch) * this.distance,
      this.aim.z + Math.cos(this.yaw) * flat,
    );
    camera.lookAt(this.aim);
    if (Math.abs(camera.fov - PHOTO_FIELD_OF_VIEW) > 0.01) {
      camera.fov = PHOTO_FIELD_OF_VIEW;
      camera.updateProjectionMatrix();
    }
  }

  /** How high the camera stands over the ground now, meters (for tests). */
  get heightMeters(): number {
    return AIM_HEIGHT_METERS + Math.sin(this.pitch) * this.distance;
  }

  get distanceMeters(): number {
    return this.distance;
  }

  private aimAt(pose: Readonly<VehiclePose>): void {
    this.aim.set(
      pose.x + Math.sin(pose.heading) * this.centreZ,
      AIM_HEIGHT_METERS,
      pose.z + Math.cos(pose.heading) * this.centreZ,
    );
  }

  /** Low shots, as low as the ground lets the camera go at this distance; not past straight down. */
  private keepAboveGround(): void {
    const lowest = Math.asin(clamp((GROUND_CLEARANCE_METERS - AIM_HEIGHT_METERS) / this.distance, -1, 0));
    this.pitch = clamp(finiteOr(this.pitch, FALLBACK_PITCH), lowest, MAX_PITCH);
  }
}
