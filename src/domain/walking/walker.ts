import { approach, clamp } from '../../core/math/scalar';

/**
 * The driver on foot: how fast they walk (the gas fully down is a brisk
 * jog, so a long way back to the cab is not a chore), back away and turn,
 * how wide they are, and the length of a stride (two steps: the legs'
 * swing comes round once).
 */
export const WALKING = {
  /** Top speed ahead, and backing away, m/s. */
  topSpeedMetersPerSecond: 3,
  backSpeedMetersPerSecond: 1.1,
  /** Up to speed and to a stop, m/s². */
  accelerationMetersPerSecondSquared: 9,
  /** Turning at full lock, radians a second: on the spot too. */
  turnRadiansPerSecond: 2.6,
  /** The body as a circle, meters. */
  radiusMeters: 0.3,
  strideMeters: 1.4,
} as const;

/** Where the walker is and how they go. Writable, so the fixed step updates it in place. */
export interface WalkerState {
  x: number;
  z: number;
  /** Radians, 0 toward +z (as the truck's). */
  heading: number;
  /** Along the heading, m/s (negative backing away). */
  speed: number;
  /** How far through the stride (radians, 0 to 2π): the legs' and the arms' swing. */
  cycle: number;
}

/** What the driver's controls ask of the walker: ahead (1) or back (-1), and a turn to the right (1) or left (-1). */
export interface WalkerControls {
  forward: number;
  turn: number;
}

/** What the walker cannot walk through: moves a circle at `at` out of it, true if it had to. */
export interface WalkerSolids {
  pushOut(at: { x: number; z: number }, radiusMeters: number): boolean;
}

/** A walker standing at the origin, facing +z. */
export function createWalker(): WalkerState {
  return { x: 0, z: 0, heading: 0, speed: 0, cycle: 0 };
}

/**
 * Moves `walker` `dt` seconds on by `controls`: up to speed (or to a stop),
 * turned (a positive turn to the right, the heading falling, as the
 * truck's), along the heading, out of what is solid, the stride on.
 * Allocation-free.
 */
export function stepWalker(walker: WalkerState, controls: Readonly<WalkerControls>, dt: number, solids: WalkerSolids): void {
  const forward = clamp(controls.forward, -1, 1);
  const target = forward >= 0 ? forward * WALKING.topSpeedMetersPerSecond : forward * WALKING.backSpeedMetersPerSecond;
  walker.speed = approach(walker.speed, target, WALKING.accelerationMetersPerSecondSquared * dt);
  walker.heading -= clamp(controls.turn, -1, 1) * WALKING.turnRadiansPerSecond * dt;
  walker.x += Math.sin(walker.heading) * walker.speed * dt;
  walker.z += Math.cos(walker.heading) * walker.speed * dt;
  solids.pushOut(walker, WALKING.radiusMeters);
  walker.cycle = (walker.cycle + (Math.abs(walker.speed) * dt * 2 * Math.PI) / WALKING.strideMeters) % (2 * Math.PI);
}
