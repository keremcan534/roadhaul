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
   */
  x: number;
  z: number;
  /** Radians. Never wrapped, so interpolating between two steps cannot jump. */
  heading: number;
  /** Meters per second along the heading; negative while reversing. */
  speed: number;
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
  /** m/s² along the heading. Used for body pitch and engine sound. */
  longitudinalAcceleration: number;
  /** m/s² toward the truck's left. Used for body roll. */
  lateralAcceleration: number;
  /** Distance driven, meters. Used for wheel rotation, fuel and statistics. */
  odometerMeters: number;
}
