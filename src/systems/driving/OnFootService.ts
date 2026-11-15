import type { EventBus } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import type { SolidContact } from '../../domain/crash/DebrisSimulation';
import type { TrailerPose } from '../../domain/vehicles/semiTrailer';
import type { VehicleFootprint } from '../../domain/vehicles/VehicleFootprint';
import type { VehicleInput } from '../../domain/vehicles/VehicleInput';
import { createWalker, stepWalker, WALKING, type WalkerSolids, type WalkerState } from '../../domain/walking/walker';
import type { GameEvents } from '../GameEvents';

/** Why the driver cannot get out: the truck is moving, it is the race car being driven, or nothing is driven. */
export type StepOutError = 'moving' | 'racing' | 'notDriving';
/** Why the driver cannot get back in: already in, or too far from the cab's door. */
export type StepInError = 'notOnFoot' | 'tooFar';

/** What on foot needs of the driving (DrivingService). */
export interface OnFootDriving {
  readonly isDriving: boolean;
  readonly racing: boolean;
  /** The truck: its rear axle's middle, its heading, its speed (m/s). */
  readonly vehicle: Readonly<{ x: number; z: number; heading: number; speed: number }>;
  readonly footprint: VehicleFootprint;
  readonly trailerFootprint: VehicleFootprint | null;
  readonly trailer: Readonly<TrailerPose> | null;
  readonly parkingBrake: boolean;
  setParkingBrake(applied: boolean): void;
  /** What stands about: trees, posts, buildings, the map's edge (DrivingWorld.collideDebris). */
  readonly world: { collideDebris(x: number, z: number, radius: number, vx: number, vz: number, out: SolidContact): boolean };
}

/** The truck stands still enough to get out below this speed, m/s. */
const STILL_METERS_PER_SECOND = 0.3;
/** The driver gets out this far beside the truck's left side, at the cab's door this far back from its front, meters. */
const DOOR_OUT_METERS = 0.9;
const DOOR_BEHIND_FRONT_METERS = 1.25;
/** The cab's door takes the driver back in from this close, meters. */
const DOOR_REACH_METERS = 2.5;
/** The driver walks at most this far from the truck, meters. */
const LEASH_METERS = 150;
/** Rounds of pushing out of what is solid, each step: enough for a corner between two. */
const PUSH_ROUNDS = 3;

/**
 * Getting out of the truck (the owner's "get out and walk round"): while it
 * stands still the driver steps out by the cab's door, its parking brake
 * set, and walks round on the same controls (the gas walks, up to a jog;
 * the brake backs away; the wheel turns). The world's solids and the truck
 * (and its trailer) stand in the way, and the driver goes no further than
 * LEASH_METERS from it. Back at the door they get in again, the parking
 * brake as they left it. The truck's controls are let go while on foot;
 * the world goes on. Not saved: a game loaded starts in the cab.
 */
export class OnFootService {
  private walking = false;
  private brakeBefore = false;
  /** Where the driver is now, and was a step ago (for drawing between the steps). */
  readonly walker: WalkerState = createWalker();
  readonly previous = { x: 0, z: 0, heading: 0 };
  private readonly controls = { forward: 0, turn: 0 };
  private readonly door = { x: 0, z: 0 };
  private readonly contact: SolidContact = { normalX: 0, normalZ: 0, depth: 0 };
  private readonly solids: WalkerSolids;

  constructor(
    private readonly driving: OnFootDriving,
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {
    this.solids = { pushOut: (at, radius) => this.pushOut(at, radius) };
    // Leaving the road (the menus, another game loaded): back in the cab.
    events.on('GameStateChanged', ({ current }) => {
      if (current !== 'driving') {
        this.reset();
      }
    });
  }

  /** The driver is out of the truck. */
  get active(): boolean {
    return this.walking;
  }

  /** Whether the driver can get out now. */
  canStepOut(): Result<void, StepOutError> {
    if (this.walking) {
      return ok(undefined);
    }
    const driving = this.driving;
    if (!driving.isDriving) {
      return err('notDriving');
    }
    if (driving.racing) {
      return err('racing');
    }
    if (Math.abs(driving.vehicle.speed) > STILL_METERS_PER_SECOND) {
      return err('moving');
    }
    return ok(undefined);
  }

  /** Whether the driver could get out now (canStepOut, without a result to read): for the HUD every frame. */
  get mayStepOut(): boolean {
    const driving = this.driving;
    return !this.walking && driving.isDriving && !driving.racing && Math.abs(driving.vehicle.speed) <= STILL_METERS_PER_SECOND;
  }

  /** Gets out by the cab's door, the parking brake set. */
  stepOut(): Result<void, StepOutError> {
    if (this.walking) {
      return ok(undefined);
    }
    const allowed = this.canStepOut();
    if (!allowed.ok) {
      return allowed;
    }
    const truck = this.driving.vehicle;
    this.placeDoor();
    const walker = this.walker;
    walker.x = this.door.x;
    walker.z = this.door.z;
    walker.heading = truck.heading;
    walker.speed = 0;
    walker.cycle = 0;
    this.solids.pushOut(walker, WALKING.radiusMeters);
    this.remember();
    this.brakeBefore = this.driving.parkingBrake;
    this.driving.setParkingBrake(true);
    this.walking = true;
    this.logger.info('The driver got out.');
    this.events.emit('DriverSteppedOut', {});
    return ok(undefined);
  }

  /** How far the driver is from the cab's door, meters (0 in the cab). */
  get toDoorMeters(): number {
    if (!this.walking) {
      return 0;
    }
    this.placeDoor();
    const dx = this.walker.x - this.door.x;
    const dz = this.walker.z - this.door.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /** Whether the driver is close enough to the door to get in. */
  get nearDoor(): boolean {
    return this.walking && this.toDoorMeters <= DOOR_REACH_METERS;
  }

  /** Gets back in at the door, the parking brake as it was. */
  stepIn(): Result<void, StepInError> {
    if (!this.walking) {
      return err('notOnFoot');
    }
    if (!this.nearDoor) {
      return err('tooFar');
    }
    this.leave();
    this.logger.info('The driver got back in.');
    this.events.emit('DriverSteppedIn', {});
    return ok(undefined);
  }

  /** Back in the cab at once, wherever the driver was (the game left, a game loaded). */
  reset(): void {
    if (this.walking) {
      this.leave();
      this.events.emit('DriverSteppedIn', {});
    }
  }

  /**
   * One fixed step on foot: the driver's `input` walks them (the gas ahead,
   * the brake back, the wheel turns), and is then let go of, so the truck
   * waits. Nothing while in the cab. Allocation-free.
   */
  update(dt: number, input: VehicleInput): void {
    if (!this.walking) {
      return;
    }
    if (!this.driving.isDriving) {
      this.reset();
      return;
    }
    this.remember();
    const controls = this.controls;
    controls.forward = input.throttle - input.brake;
    controls.turn = input.steer;
    stepWalker(this.walker, controls, dt, this.solids);
    this.keepNearTruck();
    input.throttle = 0;
    input.brake = 0;
    input.steer = 0;
  }

  private leave(): void {
    this.walking = false;
    this.walker.speed = 0;
    this.driving.setParkingBrake(this.brakeBefore);
  }

  private remember(): void {
    this.previous.x = this.walker.x;
    this.previous.z = this.walker.z;
    this.previous.heading = this.walker.heading;
  }

  /** The cab's door on the truck's left side, a step out from it. */
  private placeDoor(): void {
    const truck = this.driving.vehicle;
    const footprint = this.driving.footprint;
    let front = 0;
    for (const offset of footprint.offsets) {
      front = Math.max(front, offset);
    }
    const ahead = front + footprint.radius - DOOR_BEHIND_FRONT_METERS;
    const out = footprint.radius + DOOR_OUT_METERS;
    const sin = Math.sin(truck.heading);
    const cos = Math.cos(truck.heading);
    // The truck's left is +x in its own frame: (cos, -sin) in the world's.
    this.door.x = truck.x + cos * out + sin * ahead;
    this.door.z = truck.z - sin * out + cos * ahead;
  }

  /** No further than the leash from the truck. */
  private keepNearTruck(): void {
    const truck = this.driving.vehicle;
    const dx = this.walker.x - truck.x;
    const dz = this.walker.z - truck.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance > LEASH_METERS) {
      this.walker.x = truck.x + (dx / distance) * LEASH_METERS;
      this.walker.z = truck.z + (dz / distance) * LEASH_METERS;
    }
  }

  /** Out of the world's solids (never knocking anything over: no speed into them) and the truck's and trailer's bodies. */
  private pushOut(at: { x: number; z: number }, radius: number): boolean {
    let moved = false;
    for (let round = 0; round < PUSH_ROUNDS; round++) {
      let pushed = false;
      if (this.driving.world.collideDebris(at.x, at.z, radius, 0, 0, this.contact)) {
        at.x += this.contact.normalX * this.contact.depth;
        at.z += this.contact.normalZ * this.contact.depth;
        pushed = true;
      }
      const truck = this.driving.vehicle;
      pushed = this.outOfCircles(at, radius, truck.x, truck.z, truck.heading, this.driving.footprint) || pushed;
      const trailer = this.driving.trailer;
      const trailerFootprint = this.driving.trailerFootprint;
      if (trailer !== null && trailerFootprint !== null) {
        pushed = this.outOfCircles(at, radius, trailer.x, trailer.z, trailer.heading, trailerFootprint) || pushed;
      }
      moved = moved || pushed;
      if (!pushed) {
        break;
      }
    }
    return moved;
  }

  /** Out of a body's circles along its heading from (x, z). */
  private outOfCircles(at: { x: number; z: number }, radius: number, x: number, z: number, heading: number, footprint: VehicleFootprint): boolean {
    const sin = Math.sin(heading);
    const cos = Math.cos(heading);
    let pushed = false;
    for (const offset of footprint.offsets) {
      const cx = x + sin * offset;
      const cz = z + cos * offset;
      const dx = at.x - cx;
      const dz = at.z - cz;
      const reach = radius + footprint.radius;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared >= reach * reach) {
        continue;
      }
      const distance = Math.sqrt(distanceSquared);
      if (distance < 1e-6) {
        // Right on its middle: out to its left.
        at.x = cx + cos * reach;
        at.z = cz - sin * reach;
      } else {
        at.x = cx + (dx / distance) * reach;
        at.z = cz + (dz / distance) * reach;
      }
      pushed = true;
    }
    return pushed;
  }
}
