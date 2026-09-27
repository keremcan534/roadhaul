import { clamp, clamp01, finiteOr } from '../../core/math/scalar';
import type { VehicleDefinition } from '../../data/definitions/VehicleDefinition';
import type { Surface } from '../world/Surface';
import type { VehicleRuntimeState } from './VehicleRuntimeState';

const GRAVITY = 9.81;

/**
 * How the truck stands: on all its wheels; up on one side's or one end's,
 * as long as it can still come back down on the others (the driver still
 * drives it); in the air (a hop over a wreck, a bounce); or over: on its
 * side or its roof, or falling there, out of the driver's hands until it
 * is recovered.
 */
export const BODY_ATTITUDES = ['wheels', 'tipping', 'airborne', 'overturned'] as const;
export type BodyAttitude = (typeof BODY_ATTITUDES)[number];

/**
 * The body leans this far on its springs (radians) as the inside wheels
 * lift, which is at the rollover threshold in a steady turn. A swerve's
 * lean swings further than its turn alone would take it.
 */
export const LEAN_AT_LIFT = 0.1;
/** The body pitches this far on its springs (radians) as the wheels at one end would lift. */
export const DIP_AT_LIFT = 0.035;
/**
 * The tyres alone (braking, pulling away) pitch the body at most this
 * share of the way to lifting the wheels at one end: trucks do no stoppies
 * or wheelies. A crash's blow can lift them.
 */
const TYRE_DIP_SHARE = 0.75;
/** The springs in roll and in pitch: natural frequency (rad/s) and damping ratio. Under-damped, so the body rocks. */
const ROLL_FREQUENCY = 5.5;
const ROLL_DAMPING = 0.2;
const PITCH_FREQUENCY = 7;
const PITCH_DAMPING = 0.45;
/** The body leans and pitches on its springs about a line this high above the ground, m. */
const SPRING_CENTRE_HEIGHT = 0.6;
/** Where a crash strikes the truck, m above the ground: its bumpers, wheels and chassis. */
export const CONTACT_HEIGHT = 0.7;
/** The underside of the bumpers, m above the ground: the side view's lowest corners front and back. */
const BUMPER_HEIGHT = 0.5;
/** A full payload lowers the rollover threshold by this share: the load sits high. */
export const CARGO_ROLLOVER_LOSS = 0.1;
/** The ground's grip on the truck's body sliding on it; the surface's rolling resistance adds to it (grass drags). */
const BODY_SLIDE_FRICTION = 0.45;
/** Air and crumpling steel: a tumbling truck's roll and pitch lose this share of their rate per second. */
const TUMBLE_DRAG = 0.35;
/** A face landing slower than this (rad/s after it lands) settles on the face. */
const SETTLE_RATE = 0.4;
/** The lifted wheels slam back down: the springs take this share of the rate they came down at. */
const LANDING_KEEP = 0.85;
/** Bounces off the ground keep this share of the speed into it… */
const GROUND_RESTITUTION = 0.3;
/** …when they strike it at least this fast (m/s); slower, the truck settles. */
const BOUNCE_SPEED = 2.5;
/** A face of the body striking the ground this fast (m/s) throws the truck up: it bounces as it rolls. */
const FACE_BOUNCE_SPEED = 4;
/**
 * A corner landing grips the ground: friction takes up to this share of
 * the speed it came down at (m/s) off the body's slide, and trips it over
 * the corner the way it slid. A truck sliding sideways fast rolls on.
 */
const LANDING_GRIP = 0.4;
/** Collisions rock the body with this share of what a free body would take. */
const ROLL_KICK = 0.6;
const PITCH_KICK = 0.5;
/**
 * Driving over a car it wrecks, the truck is thrown up at this share of
 * the speed it hit it with (m/s), at most this fast, its nose up by this
 * much of the rate (rad/s per m/s).
 */
const RIDE_UP_SHARE = 0.12;
const RIDE_UP_MAX_SPEED = 3;
const RIDE_UP_PITCH = 0.015;
/** Corners this close in height (m) lie level: a face flat on the ground. */
const LEVEL_EPSILON = 1e-6;

/**
 * The truck as its body moves: its size, where its weight sits and how
 * hard it is to turn (per kg). The centre of mass sits exactly high enough
 * that a rigid truck tips at its rollover threshold: loaded, it sits
 * higher; a stiffer body (upgrades) holds it lower.
 */
export interface BodyBuild {
  /** Half the width, half the length, the height and half the wheelbase, m. */
  halfWidth: number;
  halfLength: number;
  height: number;
  halfWheelbase: number;
  /** The centre of mass: ahead of the rear axle (midway between the axles), m. */
  cogAhead: number;
  /** …and above the ground on the wheels, m. */
  cogHeight: number;
  /** Static rollover threshold, m/s²: steady cornering this hard lifts the inside wheels. */
  rolloverAcceleration: number;
  /** Squared radii of gyration about the centre of mass (m², per kg): turning, rolling and pitching. */
  yawGyration: number;
  rollGyration: number;
  pitchGyration: number;
}

/** The build of `definition` carrying `cargoMassKg`, its body `stabilityFactor` times as stiff as defined. */
export function createBodyBuild(definition: VehicleDefinition, cargoMassKg = 0, stabilityFactor = 1): BodyBuild {
  const build: BodyBuild = {
    halfWidth: 0,
    halfLength: 0,
    height: 0,
    halfWheelbase: 0,
    cogAhead: 0,
    cogHeight: 0,
    rolloverAcceleration: 0,
    yawGyration: 0,
    rollGyration: 0,
    pitchGyration: 0,
  };
  return fillBodyBuild(build, definition, cargoMassKg, stabilityFactor);
}

/** Writes the build of `definition` carrying `cargoMassKg` with its body `stabilityFactor` times as stiff into `build`. */
export function fillBodyBuild(
  build: BodyBuild,
  definition: VehicleDefinition,
  cargoMassKg: number,
  stabilityFactor: number,
): BodyBuild {
  const { body, handling } = definition;
  const payloadKg = definition.maxPayloadTons * 1000;
  const loaded = payloadKg > 0 ? clamp01(Math.max(0, finiteOr(cargoMassKg, 0)) / payloadKg) : 0;
  const thresholdG =
    handling.maxLateralAccelerationG * Math.max(0.05, finiteOr(stabilityFactor, 1)) * (1 - CARGO_ROLLOVER_LOSS * loaded);
  const width = body.widthMeters;
  const length = body.lengthMeters;
  const height = body.heightMeters;
  build.halfWidth = width / 2;
  build.halfLength = length / 2;
  build.height = height;
  build.halfWheelbase = body.wheelbaseMeters / 2;
  build.cogAhead = body.wheelbaseMeters / 2;
  // A rigid box tips where the lateral acceleration's lever beats gravity's: halfWidth / height = threshold / g.
  build.cogHeight = clamp(build.halfWidth / thresholdG, height * 0.3, height * 0.9);
  build.rolloverAcceleration = (GRAVITY * build.halfWidth) / build.cogHeight;
  build.yawGyration = (length * length + width * width) / 12;
  build.rollGyration = (width * width + height * height) / 12;
  build.pitchGyration = (length * length + height * height) / 12;
  return build;
}

/**
 * A plausible build for a truck known only by its footprint (the circles
 * it collides with, `offsets` from its rear axle): for collisions worked
 * out without the truck's own build.
 */
export function footprintBuild(offsets: readonly number[], radius: number): BodyBuild {
  let front = -Infinity;
  let rear = Infinity;
  for (const offset of offsets) {
    front = Math.max(front, offset);
    rear = Math.min(rear, offset);
  }
  const halfLength = (front - rear) / 2 + radius;
  const width = 2 * radius;
  const length = 2 * halfLength;
  const height = 3.5;
  const cogHeight = 2;
  return {
    halfWidth: radius,
    halfLength,
    height,
    halfWheelbase: Math.max(0.5, halfLength - 2),
    cogAhead: (front + rear) / 2,
    cogHeight,
    rolloverAcceleration: (GRAVITY * radius) / cogHeight,
    yawGyration: (length * length + width * width) / 12,
    rollGyration: (width * width + height * height) / 12,
    pitchGyration: (length * length + height * height) / 12,
  };
}

/**
 * A collision's push on the truck, as the change it made to its velocity
 * (m/s, `forward` along its heading and `left` across it), rocks its body:
 * struck low, below its centre of mass, the body rolls and pitches away
 * from the blow over the springs, or turns faster about the wheels or the
 * edge it stands on.
 */
export function kickBody(state: VehicleRuntimeState, build: Readonly<BodyBuild>, forward: number, left: number): void {
  const arm = build.cogHeight - CONTACT_HEIGHT;
  if (!(arm > 0)) {
    return;
  }
  const springArm = build.cogHeight - SPRING_CENTRE_HEIGHT;
  const tipped = build.rollGyration + build.cogHeight * build.cogHeight;
  // Pushed to its left low down, the top lags: the body rolls right (its left side up), the positive way.
  const roll = ROLL_KICK * arm * left;
  if (isRigid(state.bank, state.bankRate) || state.attitude === 'airborne') {
    state.bankRate += roll / tipped;
  } else {
    state.leanRate += roll / (build.rollGyration + springArm * springArm);
  }
  // Pushed back (a head-on blow), the nose dips: the positive way.
  const pitch = -PITCH_KICK * arm * forward;
  const pitchTipped = build.pitchGyration + build.cogHeight * build.cogHeight;
  if (isRigid(state.tilt, state.tiltRate) || state.attitude === 'airborne') {
    state.tiltRate += pitch / pitchTipped;
  } else {
    state.dipRate += pitch / (build.pitchGyration + springArm * springArm);
  }
}

/**
 * The truck drives over a car it wrecked, having struck it `speed` m/s
 * hard, `side` of it (+1 the car on its left, −1 on its right, 0 dead
 * ahead): it is thrown up, nose first, and rolls away from the car's side.
 */
export function rideUp(state: VehicleRuntimeState, speed: number, side: number): void {
  const into = Math.max(0, finiteOr(speed, 0));
  const up = Math.min(RIDE_UP_MAX_SPEED, RIDE_UP_SHARE * into);
  if (up <= state.riseSpeed) {
    return;
  }
  state.riseSpeed = up;
  // Nose up is the negative pitch; the side over the car rises (a car on the left lifts the left side: positive roll).
  state.dipRate -= RIDE_UP_PITCH * into;
  state.leanRate += clamp(side, -1, 1) * RIDE_UP_PITCH * into;
}

/** Whether a plane's rigid turn is under way: the truck off the wheels' face, or moving off it. */
function isRigid(angle: number, rate: number): boolean {
  return angle !== 0 || rate !== 0;
}

/**
 * The truck's body seen from behind (roll: s toward its left) or from its
 * side (pitch: s toward its back), y up: a convex polygon of corners about
 * the centre of mass, counter-clockwise, its wheels' face from corner 0 to
 * corner 1. Turning by +angle turns s toward y: the left side up (leaning
 * right), or the nose down. Rigid, it rocks and rolls on flat ground about
 * its lowest corner (roll()); the results are left in its fields.
 * Allocation-free.
 */
class Section {
  private readonly s = new Float64Array(6);
  private readonly y = new Float64Array(6);
  private count = 0;
  /** Squared radius of gyration about the centre of mass, m² (per kg). */
  gyration = 1;
  /**
   * How far the section can turn either way (radians) with its centre of
   * mass still inside its lowest corners: gravity brings it back onto its
   * wheels. Further, it goes over.
   */
  criticalAngle = 0;
  /** Results of roll(): the new angle and rate, and how far the centre of mass moved along s. */
  angle = 0;
  rate = 0;
  shift = 0;
  /** How fast a corner struck the ground (m/s), 0 when none did; and whether it was the wheels coming down. */
  impact = 0;
  landedOnWheels = false;
  /** How much the landing corner's grip changed the body's slide along s (m/s). */
  slideChange = 0;
  /** Result of lowestCorner(): where the corner is from the centre of mass. */
  cornerS = 0;
  cornerY = 0;

  /** Seen from behind: `halfWidth` either side, `height` tall, the centre of mass `cog` up. */
  setRollView(halfWidth: number, height: number, cog: number, gyration: number): void {
    this.corners(4, gyration);
    this.corner(0, -halfWidth, -cog);
    this.corner(1, halfWidth, -cog);
    this.corner(2, halfWidth, height - cog);
    this.corner(3, -halfWidth, height - cog);
  }

  /** Seen from the side: wheels `halfWheelbase` either side, bumpers `halfLength` out and `bumper` up, `height` tall. */
  setPitchView(halfWheelbase: number, halfLength: number, bumper: number, height: number, cog: number, gyration: number): void {
    this.corners(6, gyration);
    // s runs backward: the front wheel first, then round the back and over the roof to the nose.
    this.corner(0, -halfWheelbase, -cog);
    this.corner(1, halfWheelbase, -cog);
    this.corner(2, halfLength, bumper - cog);
    this.corner(3, halfLength, height - cog);
    this.corner(4, -halfLength, height - cog);
    this.corner(5, -halfLength, bumper - cog);
  }

  /** Height of the centre of mass above the ground with the section turned `angle`, resting on its lowest corner. */
  support(angle: number): number {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let lowest = Infinity;
    for (let i = 0; i < this.count; i++) {
      lowest = Math.min(lowest, this.turnedY(i, cos, sin));
    }
    return -lowest;
  }

  /** Where the lowest corner at `angle` is from the centre of mass (of a face flat on the ground, the one turning `rate`'s way). */
  lowestCorner(angle: number, rate: number): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const corner = this.pivotOf(cos, sin, rate, 0, true);
    this.cornerS = this.turnedS(corner, cos, sin);
    this.cornerY = this.turnedY(corner, cos, sin);
  }

  /**
   * Whether the section at `angle` still has its centre of mass inside the
   * corners below it, so gravity brings it back onto its wheels: a truck up
   * on two wheels, or on its nose, that can still come down.
   */
  recoverable(angle: number): boolean {
    return Math.abs(wrapAngle(angle)) < this.criticalAngle;
  }

  /**
   * Rolls the rigid section on the ground for `dt` seconds from `angle`
   * at `rate` (rad/s) about its lowest corner, under gravity and the
   * ground's `push` on that corner (m/s², along +s: the tyres' grip or the
   * ground's drag on the body). When a face comes flat on the ground it
   * lands there: the angular momentum about the corner that struck is
   * kept, the corner's grip trips the body on if it is sliding (`slide`,
   * m/s along +s), and a slow turn settles. Results in the fields.
   */
  roll(angle: number, rate: number, push: number, dt: number, slide = 0): void {
    this.impact = 0;
    this.landedOnWheels = false;
    this.shift = 0;
    this.slideChange = 0;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const pivot = this.pivotOf(cos, sin, rate, push, false);
    if (pivot < 0) {
      // At rest on a face, and nothing tips it.
      this.angle = angle;
      this.rate = 0;
      return;
    }
    const pivotS = this.turnedS(pivot, cos, sin);
    const pivotY = this.turnedY(pivot, cos, sin);
    const inertia = this.gyration + pivotS * pivotS + pivotY * pivotY;
    let turn = (rate + ((GRAVITY * pivotS - push * pivotY) / inertia) * dt) * (1 - TUMBLE_DRAG * dt);
    let next = angle + turn * dt;
    let nextCos = Math.cos(next);
    let nextSin = Math.sin(next);
    // The corner the turn swings down toward: the pivot's neighbour on that side.
    const n = this.count;
    const other = turn > 0 ? (pivot + n - 1) % n : (pivot + 1) % n;
    if (turn !== 0 && this.turnedY(other, nextCos, nextSin) < this.turnedY(pivot, nextCos, nextSin)) {
      // The face between them came flat on the ground within the step: land on it, flat.
      const faceS = this.s[other]! - this.s[pivot]!;
      const faceY = this.y[other]! - this.y[pivot]!;
      const flat = Math.atan2(-faceY, faceS);
      next = clamp(flat + Math.round((next - flat) / Math.PI) * Math.PI, Math.min(angle, next), Math.max(angle, next));
      nextCos = Math.cos(next);
      nextSin = Math.sin(next);
      const fromS = this.turnedS(pivot, nextCos, nextSin);
      const fromY = this.turnedY(pivot, nextCos, nextSin);
      const toS = this.turnedS(other, nextCos, nextSin);
      const toY = this.turnedY(other, nextCos, nextSin);
      this.impact = Math.abs(turn * (toS - fromS));
      if ((pivot === 0 && other === 1) || (pivot === 1 && other === 0)) {
        this.landedOnWheels = true;
      } else {
        // Angular momentum about the corner that struck carries on, and its grip trips the sliding body on; the
        // section cannot turn back through the ground.
        const inertia = this.gyration + toS * toS + toY * toY;
        let after = (turn * (this.gyration + fromS * toS + fromY * toY)) / inertia;
        if (slide !== 0) {
          this.slideChange = -Math.sign(slide) * Math.min(Math.abs(slide), LANDING_GRIP * this.impact);
          after -= (toY * this.slideChange) / inertia;
        }
        turn = after * turn > 0 && Math.abs(after) >= SETTLE_RATE ? after : 0;
      }
    }
    this.shift = -(this.turnedS(pivot, nextCos, nextSin) - pivotS);
    this.angle = next;
    this.rate = turn;
  }

  /**
   * The corner the section turns about at (cos, sin) going `rate`'s way:
   * the lowest one. Of a face flat on the ground, the corner at the end
   * it turns toward (the smaller s turning +, the larger turning −);
   * standing still, the one gravity and `push` tip it over, or -1 when it
   * rests on the face (`anyway` picks one regardless).
   */
  private pivotOf(cos: number, sin: number, rate: number, push: number, anyway: boolean): number {
    let low = 0;
    let lowY = Infinity;
    for (let i = 0; i < this.count; i++) {
      const y = this.turnedY(i, cos, sin);
      if (y < lowY) {
        lowY = y;
        low = i;
      }
    }
    const n = this.count;
    const before = (low + n - 1) % n;
    const after = (low + 1) % n;
    const level =
      this.turnedY(before, cos, sin) - lowY <= LEVEL_EPSILON
        ? before
        : this.turnedY(after, cos, sin) - lowY <= LEVEL_EPSILON
          ? after
          : -1;
    if (level < 0) {
      return low;
    }
    const lowFirst = this.turnedS(low, cos, sin) < this.turnedS(level, cos, sin);
    const smaller = lowFirst ? low : level;
    const larger = lowFirst ? level : low;
    if (rate > 0) {
      return smaller;
    }
    if (rate < 0) {
      return larger;
    }
    if (GRAVITY * this.turnedS(smaller, cos, sin) - push * this.turnedY(smaller, cos, sin) > 0) {
      return smaller;
    }
    if (GRAVITY * this.turnedS(larger, cos, sin) - push * this.turnedY(larger, cos, sin) < 0) {
      return larger;
    }
    return anyway ? low : -1;
  }

  private corners(count: number, gyration: number): void {
    this.count = count;
    this.gyration = gyration;
    this.criticalAngle = 0;
  }

  private corner(index: number, s: number, y: number): void {
    this.s[index] = s;
    this.y[index] = y;
    if (y < 0) {
      // Turned until it is right below the centre of mass, a corner below it stops holding it up.
      this.criticalAngle = Math.max(this.criticalAngle, Math.atan2(Math.abs(s), -y));
    }
  }

  private turnedS(index: number, cos: number, sin: number): number {
    return this.s[index]! * cos - this.y[index]! * sin;
  }

  private turnedY(index: number, cos: number, sin: number): number {
    return this.s[index]! * sin + this.y[index]! * cos;
  }
}

/**
 * The truck's body in motion (roadmap: rollovers): its lean and pitch on
 * its springs, and, when that lifts the wheels on one side or at one end,
 * the whole truck rocking on the others, falling back or rolling over;
 * rolling on across its sides and roof, flying off bumps and bouncing,
 * sliding to a stop on its side. Across (roll) and along (pitch) each run
 * on their own; the truck stands as high as the higher of the two holds
 * it. VehicleDynamics owns it and calls the steps; collisions rock it
 * (kickBody, rideUp). Every step mutates the state in place and allocates
 * nothing.
 */
export class BodyMotion {
  readonly build: BodyBuild;
  private readonly across = new Section();
  private readonly along = new Section();

  constructor(
    private readonly definition: VehicleDefinition,
    cargoMassKg = 0,
    stabilityFactor = 1,
  ) {
    this.build = createBodyBuild(definition, cargoMassKg, stabilityFactor);
    this.shape();
  }

  /** New cargo or a stiffer (or weaker) body: the centre of mass moves. */
  rebuild(cargoMassKg: number, stabilityFactor: number): void {
    fillBodyBuild(this.build, this.definition, cargoMassKg, stabilityFactor);
    this.shape();
  }

  /**
   * The body on the ground under the driver's control (on its wheels, or
   * up on some of them), after the tyres have moved the truck: its springs
   * lean it out of turns and pitch it under braking, lift its wheels past
   * the threshold, and the rigid truck rocks on the wheels still down,
   * falling back onto the others or going over. `state`'s lateral and
   * longitudinal acceleration are the tyres'.
   */
  stepGrounded(state: VehicleRuntimeState, dt: number): void {
    state.groundImpact = 0;
    if (state.riseSpeed > 0) {
      this.takeOff(state);
      return;
    }
    this.stepAcross(state, state.lateralAcceleration, dt);
    this.stepAlong(state, -state.longitudinalAcceleration, dt);
    this.settle(state);
  }

  /**
   * The body out of the driver's hands, for `dt` seconds: in the air, it
   * flies and turns until it lands (and bounces); over, it slides on the
   * ground (the surface's drag, plus the steel's) and rolls on about its
   * edges. Moves the truck too: nothing drives or steers it.
   */
  stepLoose(state: VehicleRuntimeState, surface: Surface, dt: number): void {
    state.groundImpact = 0;
    if (state.attitude === 'airborne') {
      this.fly(state, dt);
      return;
    }
    if (state.riseSpeed > 0) {
      this.takeOff(state);
      this.fly(state, dt);
      return;
    }
    const { cogAhead, halfLength, yawGyration } = this.build;
    // Nothing steers it: the path's yaw carries on as spin.
    state.spinRate += -state.speed * state.pathCurvature;
    state.pathCurvature = 0;
    // The ground drags the centre of mass (and the spin) to a stop.
    const friction = (BODY_SLIDE_FRICTION + surface.rollingResistance) * GRAVITY;
    const sideways = state.slipSpeed + state.spinRate * cogAhead;
    const speed = Math.hypot(state.speed, sideways);
    let pushAcross = 0;
    let pushAlong = 0;
    if (speed > 1e-9) {
      const slowdown = Math.min(speed, friction * dt);
      const forward = state.speed - (state.speed / speed) * slowdown;
      const across = sideways - (sideways / speed) * slowdown;
      pushAcross = (across - sideways) / dt;
      // s runs backward along the truck: the drag slowing it forward pushes it back.
      pushAlong = -(forward - state.speed) / dt;
      state.speed = forward;
      state.slipSpeed = across - state.spinRate * cogAhead;
    }
    const spinDrag = ((friction * halfLength) / (2 * yawGyration)) * dt;
    const spinBefore = state.spinRate;
    state.spinRate = Math.abs(state.spinRate) <= spinDrag ? 0 : state.spinRate - Math.sign(state.spinRate) * spinDrag;
    // Keep the centre of mass's sideways speed as the spin dies: the reference axle behind it slides instead.
    state.slipSpeed += (spinBefore - state.spinRate) * cogAhead;
    state.lateralAcceleration = pushAcross;
    state.longitudinalAcceleration = -pushAlong;
    this.move(state, dt);
    this.stepAcross(state, pushAcross, dt, true);
    this.stepAlong(state, pushAlong, dt, true);
    this.settle(state);
  }

  /**
   * The body rocks and rolls across the truck (seen from behind), `push`
   * m/s² to its left at the ground; `sliding` when nothing but the ground's
   * drag holds it (over: a landing corner's grip trips it on).
   */
  private stepAcross(state: VehicleRuntimeState, push: number, dt: number, sliding = false): void {
    const build = this.build;
    if (!isRigid(state.bank, state.bankRate)) {
      const springArm = build.cogHeight - SPRING_CENTRE_HEIGHT;
      const target = (LEAN_AT_LIFT * push) / build.rolloverAcceleration;
      state.leanRate += (ROLL_FREQUENCY * ROLL_FREQUENCY * (target - state.lean) - 2 * ROLL_DAMPING * ROLL_FREQUENCY * state.leanRate) * dt;
      state.lean += state.leanRate * dt;
      if (Math.abs(state.lean) >= LEAN_AT_LIFT && state.lean * state.leanRate > 0) {
        // The inside wheels leave the ground: the whole truck turns about the outside ones, its lean kept, and its
        // angular momentum about them too (the body swinging on its springs, its centre of mass sweeping sideways).
        const onWheel = build.rollGyration + build.halfWidth * build.halfWidth + build.cogHeight * build.cogHeight;
        state.bankRate = (state.leanRate * (build.rollGyration + springArm * build.cogHeight)) / onWheel;
        state.lean = Math.sign(state.lean) * LEAN_AT_LIFT;
        state.leanRate = 0;
      }
      return;
    }
    const section = this.across;
    const cogAhead = build.cogAhead;
    section.roll(state.bank, state.bankRate, push, dt, sliding ? state.slipSpeed + state.spinRate * cogAhead : 0);
    state.slipSpeed += section.slideChange;
    this.shiftAcross(state, section.shift);
    if (section.landedOnWheels) {
      // Back on all its wheels: the springs catch the rest of the fall.
      state.leanRate = section.rate * LANDING_KEEP;
      state.bank = 0;
      state.bankRate = 0;
      state.groundImpact = Math.max(state.groundImpact, section.impact);
      return;
    }
    state.bank = section.angle;
    state.bankRate = section.rate;
    state.groundImpact = Math.max(state.groundImpact, section.impact);
    if (!section.recoverable(state.bank)) {
      // Going over: the springs let go of their lean.
      state.lean *= 1 - Math.min(1, 4 * dt);
      state.leanRate = 0;
    }
    if (section.impact >= FACE_BOUNCE_SPEED) {
      state.riseSpeed = Math.max(state.riseSpeed, section.impact * GROUND_RESTITUTION * 0.5);
    }
  }

  /** The body rocks and pitches along the truck (seen from its side), `push` m/s² backward at the ground (see stepAcross). */
  private stepAlong(state: VehicleRuntimeState, push: number, dt: number, sliding = false): void {
    const build = this.build;
    if (!isRigid(state.tilt, state.tiltRate)) {
      const springArm = build.cogHeight - SPRING_CENTRE_HEIGHT;
      // The wheels at one end would lift where the push's lever beats gravity's: halfWheelbase / cogHeight.
      const threshold = (GRAVITY * build.halfWheelbase) / build.cogHeight;
      const target = clamp((DIP_AT_LIFT * push) / threshold, -TYRE_DIP_SHARE * DIP_AT_LIFT, TYRE_DIP_SHARE * DIP_AT_LIFT);
      state.dipRate += (PITCH_FREQUENCY * PITCH_FREQUENCY * (target - state.dip) - 2 * PITCH_DAMPING * PITCH_FREQUENCY * state.dipRate) * dt;
      state.dip += state.dipRate * dt;
      if (Math.abs(state.dip) >= DIP_AT_LIFT && state.dip * state.dipRate > 0) {
        const onWheel = build.pitchGyration + build.halfWheelbase * build.halfWheelbase + build.cogHeight * build.cogHeight;
        state.tiltRate = (state.dipRate * (build.pitchGyration + springArm * build.cogHeight)) / onWheel;
        state.dip = Math.sign(state.dip) * DIP_AT_LIFT;
        state.dipRate = 0;
      }
      return;
    }
    const section = this.along;
    // s runs backward: the slide along it is the speed backward, and the centre of mass moving along +s moves the truck back.
    section.roll(state.tilt, state.tiltRate, push, dt, sliding ? -state.speed : 0);
    state.speed -= section.slideChange;
    this.shiftAlong(state, -section.shift);
    if (section.landedOnWheels) {
      state.dipRate = section.rate * LANDING_KEEP;
      state.tilt = 0;
      state.tiltRate = 0;
      state.groundImpact = Math.max(state.groundImpact, section.impact);
      return;
    }
    state.tilt = section.angle;
    state.tiltRate = section.rate;
    state.groundImpact = Math.max(state.groundImpact, section.impact);
    if (!section.recoverable(state.tilt)) {
      state.dip *= 1 - Math.min(1, 4 * dt);
      state.dipRate = 0;
    }
    if (section.impact >= FACE_BOUNCE_SPEED) {
      state.riseSpeed = Math.max(state.riseSpeed, section.impact * GROUND_RESTITUTION * 0.5);
    }
  }

  /**
   * How high the truck stands (the higher of what holds it up across and
   * along) and how it stands now (`attitude`).
   */
  private settle(state: VehicleRuntimeState): void {
    const rolling = isRigid(state.bank, state.bankRate);
    const pitching = isRigid(state.tilt, state.tiltRate);
    const build = this.build;
    // On its springs a way, the truck stands on its wheels that way: the rigid way holds it up (both: the higher).
    const across = rolling ? this.across.support(state.bank) : -Infinity;
    const along = pitching ? this.along.support(state.tilt) : -Infinity;
    state.rise = rolling || pitching ? Math.max(across, along) - build.cogHeight : 0;
    if (!rolling && !pitching) {
      state.attitude = 'wheels';
    } else if ((rolling && !this.across.recoverable(state.bank)) || (pitching && !this.along.recoverable(state.tilt))) {
      state.attitude = 'overturned';
    } else {
      state.attitude = 'tipping';
    }
  }

  /** Leaves the ground: the springs' lean and pitch become the whole body's turn in the air; the path's yaw carries on. */
  private takeOff(state: VehicleRuntimeState): void {
    state.bank += state.lean;
    state.bankRate += state.leanRate;
    state.lean = 0;
    state.leanRate = 0;
    state.tilt += state.dip;
    state.tiltRate += state.dipRate;
    state.dip = 0;
    state.dipRate = 0;
    state.spinRate += -state.speed * state.pathCurvature;
    state.pathCurvature = 0;
    state.attitude = 'airborne';
  }

  /** In the air: it falls and turns freely, the truck carrying on as it left the ground, until it lands. */
  private fly(state: VehicleRuntimeState, dt: number): void {
    const build = this.build;
    state.riseSpeed -= GRAVITY * dt;
    state.rise += state.riseSpeed * dt;
    state.bankRate *= 1 - TUMBLE_DRAG * dt * 0.25;
    state.tiltRate *= 1 - TUMBLE_DRAG * dt * 0.25;
    state.bank += state.bankRate * dt;
    state.tilt += state.tiltRate * dt;
    state.lateralAcceleration = 0;
    state.longitudinalAcceleration = 0;
    this.move(state, dt);
    const across = this.across.support(state.bank);
    const along = this.along.support(state.tilt);
    const support = Math.max(across, along) - build.cogHeight;
    if (state.rise > support) {
      return;
    }
    // Landed on its lowest corner: the ground stops that corner (and bounces it back a little if it came down hard).
    const acrossLands = across >= along;
    const section = acrossLands ? this.across : this.along;
    const angle = acrossLands ? state.bank : state.tilt;
    const rate = acrossLands ? state.bankRate : state.tiltRate;
    section.lowestCorner(angle, rate);
    const cornerS = section.cornerS;
    const cornerY = section.cornerY;
    const down = state.riseSpeed + rate * cornerS;
    let turn = rate;
    if (down < 0) {
      const bounce = -down >= BOUNCE_SPEED ? GROUND_RESTITUTION : 0;
      const impulse = (-(1 + bounce) * down) / (1 + (cornerS * cornerS) / section.gyration);
      state.riseSpeed += impulse;
      turn += (cornerS * impulse) / section.gyration;
      state.groundImpact = Math.max(state.groundImpact, -down);
      // The corner grips as it lands: friction takes some of its slide (the body's, and the turn's), tripping it.
      const slide = acrossLands ? state.slipSpeed + state.spinRate * build.cogAhead : -state.speed;
      const cornerSlide = slide - rate * cornerY;
      if (cornerSlide !== 0) {
        const change = -Math.sign(cornerSlide) * Math.min(Math.abs(cornerSlide), LANDING_GRIP * -down);
        turn -= (cornerY * change) / section.gyration;
        if (acrossLands) {
          state.slipSpeed += change;
        } else {
          state.speed -= change;
        }
      }
    }
    if (acrossLands) {
      state.bankRate = turn;
    } else {
      state.tiltRate = turn;
    }
    state.rise = support;
    if (state.riseSpeed > BOUNCE_SPEED * GROUND_RESTITUTION * 0.5) {
      // Bounced: still in the air.
      return;
    }
    state.riseSpeed = 0;
    this.land(state);
  }

  /**
   * Down for good: each way, a body turned no further than its springs
   * lean goes back onto them; one turned further rocks on its edge.
   */
  private land(state: VehicleRuntimeState): void {
    const bank = wrapAngle(state.bank);
    if (Math.abs(bank) <= LEAN_AT_LIFT) {
      state.lean = bank;
      state.leanRate = state.bankRate * LANDING_KEEP;
      state.bank = 0;
      state.bankRate = 0;
    } else {
      state.bank = bank;
      state.lean = 0;
      state.leanRate = 0;
    }
    const tilt = wrapAngle(state.tilt);
    if (Math.abs(tilt) <= DIP_AT_LIFT) {
      state.dip = tilt;
      state.dipRate = state.tiltRate * LANDING_KEEP;
      state.tilt = 0;
      state.tiltRate = 0;
    } else {
      state.tilt = tilt;
      state.dip = 0;
      state.dipRate = 0;
    }
    this.settle(state);
  }

  /**
   * Moves the truck (its reference, the rear axle's place) along its
   * velocity, its body turning at its spin: about its centre of mass, which
   * keeps going its way (nothing steers it).
   */
  private move(state: VehicleRuntimeState, dt: number): void {
    const turn = state.spinRate * dt;
    if (turn !== 0) {
      const cogAhead = this.build.cogAhead;
      const forward = state.speed;
      const side = state.slipSpeed + state.spinRate * cogAhead;
      const turnCos = Math.cos(turn);
      const turnSin = Math.sin(turn);
      state.speed = forward * turnCos + side * turnSin;
      state.slipSpeed = side * turnCos - forward * turnSin - state.spinRate * cogAhead;
      state.heading += turn;
    }
    const sin = Math.sin(state.heading);
    const cos = Math.cos(state.heading);
    state.x += (state.speed * sin + state.slipSpeed * cos) * dt;
    state.z += (state.speed * cos - state.slipSpeed * sin) * dt;
    state.odometerMeters += Math.abs(state.speed) * dt;
  }

  /** Moves the truck `meters` toward its left: its centre of mass shifting as it rolls about an edge. */
  private shiftAcross(state: VehicleRuntimeState, meters: number): void {
    state.x += Math.cos(state.heading) * meters;
    state.z -= Math.sin(state.heading) * meters;
  }

  /** Moves the truck `meters` forward. */
  private shiftAlong(state: VehicleRuntimeState, meters: number): void {
    state.x += Math.sin(state.heading) * meters;
    state.z += Math.cos(state.heading) * meters;
  }

  private shape(): void {
    const build = this.build;
    this.across.setRollView(build.halfWidth, build.height, build.cogHeight, build.rollGyration);
    this.along.setPitchView(
      build.halfWheelbase,
      build.halfLength,
      Math.min(BUMPER_HEIGHT, build.height * 0.3),
      build.height,
      build.cogHeight,
      build.pitchGyration,
    );
  }
}

/** `angle` taken round to −π…π. */
function wrapAngle(angle: number): number {
  return angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI));
}
