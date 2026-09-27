import type { BodyAttitude } from './bodyMotion';

/**
 * Live state of a truck while it is being driven (spec §49). VehicleDynamics
 * mutates it in place every fixed step, so the simulation does not allocate.
 * Fuel and damage join it in roadmap steps 15–16.
 *
 * Coordinates: the ground is the X/Z plane, Y is up. `heading` 0 faces +Z and
 * grows counter-clockwise seen from above, so turning left increases it.
 */
export interface VehicleRuntimeState {
  /**
   * Position of the rear axle's midpoint on the ground, meters: the kinematic
   * bicycle model's reference point. The body centre is `wheelbase / 2` ahead.
   * With the truck off its wheels (bodyMotion), it is where that point would
   * be under the centre of mass: the truck rolling on an edge moves it.
   */
  x: number;
  z: number;
  /** Radians. Never wrapped, so interpolating between two steps cannot jump. */
  heading: number;
  /** Meters per second along the heading; negative while reversing. */
  speed: number;
  /**
   * The rear axle's speed sideways, m/s toward the truck's left: a shove
   * from a crash, a slide on its side. The tyres pull it back to nothing
   * (they do not drift); 0 in plain driving.
   */
  slipSpeed: number;
  /** Turning beyond the path the wheels follow, rad/s (positive turning left): a crash's spin, dying away. */
  spinRate: number;
  /** How the truck stands: on its wheels, up on some of them, in the air, or over (bodyMotion). */
  attitude: BodyAttitude;
  /**
   * The body's lean on its springs, radians: positive leaning right (its
   * left side up), out of a left turn; and how fast it leans.
   */
  lean: number;
  leanRate: number;
  /**
   * The whole truck's roll off its wheels (up on the right ones, over on
   * its side or roof), radians, the same way round, and its rate. 0 on all
   * its wheels; never wrapped while it rolls.
   */
  bank: number;
  bankRate: number;
  /** The body's pitch on its springs, radians: positive nose down (braking); and its rate. */
  dip: number;
  dipRate: number;
  /** The whole truck's pitch off its wheels (up on the front ones, end over end), radians, nose down; and its rate. */
  tilt: number;
  tiltRate: number;
  /**
   * How far the centre of mass is above where it rests on the wheels, m
   * (up on two wheels, in the air; below on its side), and how fast it rises.
   */
  rise: number;
  riseSpeed: number;
  /** How hard the body struck the ground in the last step, m/s: lifted wheels slamming down, a side, a landing. */
  groundImpact: number;
  /**
   * Where the steering wheel is, -1 full left … +1 full right: it follows the
   * driver's input at the steering's pace, and comes back to straight faster.
   */
  steerPosition: number;
  /** Front wheel angle in radians; positive steers right. The wheel's position times the range the speed allows. */
  steerAngle: number;
  /**
   * How sharply the truck's path bends, 1/m (positive to the right). It
   * follows the front wheels' over a moment: a heavy truck turns in, it does
   * not snap round.
   */
  pathCurvature: number;
  /** The gas and brake pedals' travel as the truck feels it, 0..1: pressed in and let go over a moment. */
  throttlePedal: number;
  brakePedal: number;
  /** How much of the engine's pull reaches the wheels, 0..1: the clutch lets go through a gear change and takes up again. */
  driveEngagement: number;
  /** The gear the clutch still holds: the one being left while a change lets it go, the current one otherwise. */
  clutchGear: number;
  /** -1 is reverse, 1…n are the forward gears. */
  gear: number;
  engineRpm: number;
  /** Seconds left in the current gear change; there is no drive meanwhile. */
  shiftTimer: number;
  /** Seconds since the last gear change. Down-shifts wait for it, so the gearbox cannot hunt. */
  timeInGear: number;
  /** Seconds the driver has held the pedal that asks to change direction at a standstill. */
  directionChangeTimer: number;
  /** m/s² along the heading, from the tyres (or the ground's drag while over). Used for body pitch and engine sound. */
  longitudinalAcceleration: number;
  /** m/s² toward the truck's left, from the tyres (or the ground's drag while over). Used for body roll. */
  lateralAcceleration: number;
  /** Distance driven, meters. Used for wheel rotation, fuel and statistics. */
  odometerMeters: number;
}
