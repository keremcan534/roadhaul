import { Vector3, type PerspectiveCamera } from 'three';
import { dampFactor } from '../../core/math/scalar';
import type { VehicleBody } from '../../data/definitions/VehicleDefinition';
import type { VehiclePose } from '../../systems/driving/DrivingService';

export type CameraMode = 'chase' | 'cabin';

const CHASE_DISTANCE_METERS = 10.5;
/** Extra distance per m/s of speed, so the truck does not fill the screen at speed. */
const CHASE_DISTANCE_PER_SPEED = 0.1;
/** High enough to see the road over the cargo box. */
const CHASE_HEIGHT_METERS = 4.8;
const CHASE_LOOK_AHEAD_METERS = 10;
const CHASE_LOOK_HEIGHT_METERS = 2.6;
const CHASE_FOLLOW_RATE = 6;
const CHASE_FOV = 60;
const CABIN_FOV = 72;
/** Menus show the parked truck from a camera circling it slowly. */
const SHOWCASE_DISTANCE_METERS = 14;
const SHOWCASE_HEIGHT_METERS = 4.2;
const SHOWCASE_LOOK_HEIGHT_METERS = 1.8;
const SHOWCASE_TURN_RATE = 0.15;

/**
 * Third-person chase and cabin cameras (spec §31). The chase camera trails
 * the truck smoothly; the cabin camera sits at the driver's eye, left seat
 * (the map drives on the right). Behind the menus, a showcase camera circles
 * the parked truck. Allocation-free per frame.
 */
export class CameraRig {
  private mode: CameraMode = 'chase';
  private readonly position = new Vector3();
  private readonly target = new Vector3();
  private snapNextFrame = true;
  private showcaseEnabled = false;
  /** Radians around the truck, measured like headings (0 = in front of it along +Z). */
  private showcaseAngle = 2.4;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly body: VehicleBody,
  ) {
    this.applyFieldOfView();
  }

  get currentMode(): CameraMode {
    return this.mode;
  }

  toggleMode(): CameraMode {
    this.mode = this.mode === 'chase' ? 'cabin' : 'chase';
    this.snapNextFrame = true;
    this.applyFieldOfView();
    return this.mode;
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

  /** Follows the (interpolated) truck pose. */
  update(pose: Readonly<VehiclePose>, speed: number, deltaSeconds: number): void {
    const sin = Math.sin(pose.heading);
    const cos = Math.cos(pose.heading);
    const centreAhead = this.body.wheelbaseMeters / 2;

    if (this.showcaseEnabled) {
      this.showcaseAngle = (this.showcaseAngle + SHOWCASE_TURN_RATE * deltaSeconds) % (2 * Math.PI);
      const centreX = pose.x + sin * centreAhead;
      const centreZ = pose.z + cos * centreAhead;
      const around = pose.heading + this.showcaseAngle;
      this.position.set(
        centreX + Math.sin(around) * SHOWCASE_DISTANCE_METERS,
        SHOWCASE_HEIGHT_METERS,
        centreZ + Math.cos(around) * SHOWCASE_DISTANCE_METERS,
      );
      this.target.set(centreX, SHOWCASE_LOOK_HEIGHT_METERS, centreZ);
    } else if (this.mode === 'chase') {
      const back = CHASE_DISTANCE_METERS + Math.abs(speed) * CHASE_DISTANCE_PER_SPEED;
      const desiredX = pose.x + sin * (centreAhead - back);
      const desiredZ = pose.z + cos * (centreAhead - back);
      const lookX = pose.x + sin * (centreAhead + CHASE_LOOK_AHEAD_METERS);
      const lookZ = pose.z + cos * (centreAhead + CHASE_LOOK_AHEAD_METERS);
      if (this.snapNextFrame) {
        this.position.set(desiredX, CHASE_HEIGHT_METERS, desiredZ);
        this.target.set(lookX, CHASE_LOOK_HEIGHT_METERS, lookZ);
      } else {
        const follow = dampFactor(CHASE_FOLLOW_RATE, deltaSeconds);
        this.position.x += (desiredX - this.position.x) * follow;
        this.position.y += (CHASE_HEIGHT_METERS - this.position.y) * follow;
        this.position.z += (desiredZ - this.position.z) * follow;
        this.target.x += (lookX - this.target.x) * follow;
        this.target.y += (CHASE_LOOK_HEIGHT_METERS - this.target.y) * follow;
        this.target.z += (lookZ - this.target.z) * follow;
      }
    } else {
      // Driver's eye: left seat (+X locally), near the top of the cab, just behind the windscreen.
      const { lengthMeters, widthMeters, heightMeters } = this.body;
      const seatSide = widthMeters * 0.22;
      const eyeAhead = centreAhead + lengthMeters / 2 - 0.9;
      const eyeHeight = heightMeters * 0.72;
      this.position.set(pose.x + cos * seatSide + sin * eyeAhead, eyeHeight, pose.z - sin * seatSide + cos * eyeAhead);
      this.target.set(this.position.x + sin * 30, eyeHeight - 1.5, this.position.z + cos * 30);
    }
    this.snapNextFrame = false;
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.target);
  }

  private applyFieldOfView(): void {
    this.camera.fov = this.showcaseEnabled || this.mode === 'chase' ? CHASE_FOV : CABIN_FOV;
    this.camera.updateProjectionMatrix();
  }
}
