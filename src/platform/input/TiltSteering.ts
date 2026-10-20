import { clamp, dampFactor, degreesToRadians } from '../../core/math/scalar';
import type { TiltSensitivity } from '../../data/config/controls';

/** How far the phone turns, degrees either way, for full lock. */
const FULL_LOCK_DEGREES: Readonly<Record<TiltSensitivity, number>> = { low: 45, normal: 32, high: 22 };
/** Turns smaller than this steer nothing, so the truck runs straight in slightly shaky or slightly askew hands. */
const DEAD_ZONE = degreesToRadians(3);
/**
 * The response curve: this share of the steering grows with the cube of the turn, the rest in step with it. A small
 * turn steers gently (a quarter of the way to full lock steers about an eighth), for the fine corrections a lane needs at
 * speed and a hand's tremor that does not weave the truck; full lock is still where it was.
 */
const EXPO = 0.55;
/** Readings weaker than this, m/s², are not gravity: a broken sensor, or the phone falling. */
const MIN_GRAVITY = 4;
/**
 * The phone lies within about 15° of flat when less than this fraction of
 * gravity pulls along the screen: which way is up on the screen is then
 * unknown, so it does not steer.
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
const FOLLOW_RATE = 10;
/** Steering this close to the reading has arrived. */
const SNAP = 1e-3;
/** A recentre takes the phone's turn averaged over about this long, seconds, and never more than this far from level. */
const RECENTRE_AVERAGE_SECONDS = 0.3;
const MAX_RECENTRE = degreesToRadians(20);

/**
 * Steering by turning the phone like a steering wheel. It reads the
 * accelerometer with gravity (m/s², in the phone's own axes: x to the right
 * of the screen, y up it, z out of it, in its natural orientation) and the
 * screen's turn from that orientation (`screenAngleDegrees`, the screen
 * orientation API's), and measures how far the screen has turned from level
 * about its own axis: held level, the truck runs straight, in portrait and
 * both landscapes, tipped back as far as the player likes.
 *
 * Level is straight ahead by itself, so no reading taken while the phone is
 * picked up or tapped can set it askew. A player who holds the phone turned
 * a little can make that straight ahead (`recenter`, from a tap: the turn
 * averaged over a moment, at most 20°); `level` goes back to level. Browsers
 * that report gravity with the opposite sign (all three axes flipped) are
 * told apart by which way gravity pulls along the screen. Clockwise (seen
 * from the front) is right. No DOM: `TiltInput` feeds it.
 */
export class TiltSteering {
  /** -1 full left … +1 full right, eased toward the latest reading by `update()`. */
  steer = 0;
  private target = 0;
  private fullLock: number;
  /** The phone's turn from level at the latest reading, radians, and averaged over a moment. */
  private turn = 0;
  private averageTurn = 0;
  private hasTurn = false;
  /** Straight ahead, radians from level: 0, or the turn a recentre took. */
  private offset = 0;
  /** -1 where the browser reports gravity flipped; 0 until told. */
  private sign = 0;
  private recentring = false;

  constructor(sensitivity: TiltSensitivity) {
    this.fullLock = degreesToRadians(FULL_LOCK_DEGREES[sensitivity]);
  }

  set sensitivity(sensitivity: TiltSensitivity) {
    this.fullLock = degreesToRadians(FULL_LOCK_DEGREES[sensitivity]);
  }

  /** False until a reading with the phone off the flat has told which way gravity is reported. */
  get isCalibrated(): boolean {
    return this.sign !== 0;
  }

  /** The phone as it is held now (its turn averaged over a moment, at most 20° from level) becomes straight ahead. */
  recenter(): void {
    if (this.hasTurn) {
      this.offset = clamp(this.averageTurn, -MAX_RECENTRE, MAX_RECENTRE);
      this.recentring = false;
    } else {
      // No reading yet: at the first one.
      this.recentring = true;
    }
    this.target = 0;
  }

  /** Straight ahead is the screen held level again. */
  level(): void {
    this.offset = 0;
    this.recentring = false;
  }

  /** Lets go at once: straight ahead level, the steering centred, gravity's sign told again. */
  reset(): void {
    this.level();
    this.target = 0;
    this.steer = 0;
    this.hasTurn = false;
    this.sign = 0;
  }

  /**
   * One accelerometer reading, gravity included, with the screen turned
   * `screenAngleDegrees` from the phone's natural orientation (0, 90, 180
   * or 270). False when it cannot steer: not a real reading, or the phone
   * lying flat before the sign is known.
   */
  read(x: number, y: number, z: number, screenAngleDegrees = 0): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return false;
    }
    const gravity = Math.hypot(x, y, z);
    if (gravity < MIN_GRAVITY) {
      return false;
    }
    // The screen's up and right in the phone's axes: turned the screen's angle anticlockwise from upright.
    const angle = degreesToRadians(Number.isFinite(screenAngleDegrees) ? screenAngleDegrees : 0);
    const upX = Math.sin(angle);
    const upY = Math.cos(angle);
    const rightX = upY;
    const rightY = -upX;
    let along = x * upX + y * upY;
    let across = x * rightX + y * rightY;
    if (this.sign === 0) {
      if (Math.hypot(x, y) < MIN_PLANE_FRACTION * gravity) {
        return false;
      }
      // Held like a wheel, the screen's top is up: gravity's reaction runs up the screen, unless the browser flips it.
      this.sign = along >= 0 ? 1 : -1;
    }
    along *= this.sign;
    across *= this.sign;
    // Turning the phone clockwise swings the world's up anticlockwise across the screen: across goes negative.
    this.turn = Math.atan2(-across, Math.max(along, FLAT_FLOOR * gravity));
    if (!this.hasTurn) {
      this.averageTurn = this.turn;
      this.hasTurn = true;
    }
    if (this.recentring) {
      this.recenter();
    }
    const steering = this.turn - this.offset;
    const beyond = Math.abs(steering) - DEAD_ZONE;
    const share = Math.min(1, beyond / (this.fullLock - DEAD_ZONE));
    this.target = beyond <= 0 ? 0 : Math.sign(steering) * (share * (1 - EXPO) + share * share * share * EXPO);
    return true;
  }

  /** Per frame: eases `steer` toward the latest reading, and the averaged turn toward the latest. */
  update(deltaSeconds: number): void {
    this.steer += (this.target - this.steer) * dampFactor(FOLLOW_RATE, deltaSeconds);
    if (Math.abs(this.steer - this.target) < SNAP) {
      this.steer = this.target;
    }
    if (this.hasTurn) {
      this.averageTurn += (this.turn - this.averageTurn) * dampFactor(1 / RECENTRE_AVERAGE_SECONDS, deltaSeconds);
    }
  }
}
