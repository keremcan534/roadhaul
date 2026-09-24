import { dampFactor, degreesToRadians } from '../../core/math/scalar';
import type { TiltSensitivity } from '../../data/config/controls';

/** How far the phone turns, degrees either way, for full lock. */
const FULL_LOCK_DEGREES: Readonly<Record<TiltSensitivity, number>> = { low: 45, normal: 32, high: 22 };
/** Turns smaller than this steer nothing, so the truck runs straight in slightly shaky hands. */
const DEAD_ZONE = degreesToRadians(2);
/** Readings weaker than this, m/s², are not gravity: a broken sensor, or the phone falling. */
const MIN_GRAVITY = 4;
/**
 * The phone lies within about 15° of flat when less than this fraction of
 * gravity pulls along the screen: which way is up on the screen is then
 * unknown, so the phone cannot be calibrated.
 */
const MIN_PLANE_FRACTION = 0.25;
/**
 * Tipped back past about 60° from upright, turning the phone like a wheel
 * moves gravity less and less along the screen, until the angle is noise.
 * From there the angle is read against this fraction of gravity instead,
 * so the steering stays steady right down to a phone held flat.
 */
const FLAT_FLOOR = 0.5;
/** How fast the steering follows the phone, 1/s: direct, but smooth through hand tremor. */
const FOLLOW_RATE = 14;
/** Steering this close to the reading has arrived. */
const SNAP = 1e-3;

/**
 * Steering by turning the phone like a steering wheel. It reads the
 * accelerometer with gravity (m/s², in the phone's own axes: x to the right
 * of the screen, y up it, z out of it, in its natural orientation) and
 * measures how far the phone has turned about the screen's axis from where
 * it was held when calibrated: that position is straight ahead. The first
 * reading calibrates, and again after `recenter()`.
 *
 * Only angles between two readings count, so it works in portrait and both
 * landscapes, tipped back as far as the player likes, and on browsers that
 * report gravity with the opposite sign (all three axes flipped). Clockwise
 * (seen from the front) is right. No DOM: `TiltInput` feeds it.
 */
export class TiltSteering {
  /** -1 full left … +1 full right, eased toward the latest reading by `update()`. */
  steer = 0;
  private target = 0;
  private fullLock: number;
  private calibrated = false;
  /** Straight ahead: the direction gravity pulled along the screen when calibrated (a unit vector). */
  private upX = 0;
  private upY = 1;

  constructor(sensitivity: TiltSensitivity) {
    this.fullLock = degreesToRadians(FULL_LOCK_DEGREES[sensitivity]);
  }

  set sensitivity(sensitivity: TiltSensitivity) {
    this.fullLock = degreesToRadians(FULL_LOCK_DEGREES[sensitivity]);
  }

  /** False until a reading with the phone off the flat has set straight ahead. */
  get isCalibrated(): boolean {
    return this.calibrated;
  }

  /** The phone as it is held at the next reading becomes straight ahead. */
  recenter(): void {
    this.calibrated = false;
    this.target = 0;
  }

  /** Lets go at once: straight ahead, and calibrated again at the next reading. */
  reset(): void {
    this.recenter();
    this.steer = 0;
  }

  /**
   * One accelerometer reading, gravity included. False when it cannot
   * steer: not a real reading, or not calibrated yet with the phone flat.
   */
  read(x: number, y: number, z: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return false;
    }
    const gravity = Math.hypot(x, y, z);
    if (gravity < MIN_GRAVITY) {
      return false;
    }
    if (!this.calibrated) {
      const alongScreen = Math.hypot(x, y);
      if (alongScreen < MIN_PLANE_FRACTION * gravity) {
        return false;
      }
      this.upX = x / alongScreen;
      this.upY = y / alongScreen;
      this.calibrated = true;
    }
    // Gravity across and along straight-ahead's direction: turning the phone clockwise swings gravity
    // anticlockwise across the screen, which makes `across` positive.
    const across = y * this.upX - x * this.upY;
    const along = x * this.upX + y * this.upY;
    const angle = Math.atan2(across, Math.max(along, FLAT_FLOOR * gravity));
    const beyond = Math.abs(angle) - DEAD_ZONE;
    this.target = beyond <= 0 ? 0 : Math.sign(angle) * Math.min(1, beyond / (this.fullLock - DEAD_ZONE));
    return true;
  }

  /** Per frame: eases `steer` toward the latest reading. */
  update(deltaSeconds: number): void {
    this.steer += (this.target - this.steer) * dampFactor(FOLLOW_RATE, deltaSeconds);
    if (Math.abs(this.steer - this.target) < SNAP) {
      this.steer = this.target;
    }
  }
}
