/**
 * How strong a truck's engine, brakes, tyres and body are relative to its
 * definition. Damage lowers them, upgrades raise them; the factors of every
 * source multiply (DrivingService). 1 is the truck as defined.
 */
export interface PerformanceFactors {
  /** Engine torque and power. */
  readonly torqueFactor: number;
  /** Brake force. */
  readonly brakeFactor: number;
  /** Tyre grip: the traction, braking and cornering limits on every surface. */
  readonly gripFactor: number;
  /** The cornering limit before the body leans too far (maxLateralAccelerationG). */
  readonly stabilityFactor: number;
}

/** The truck exactly as defined. */
export const BASE_PERFORMANCE: PerformanceFactors = Object.freeze({
  torqueFactor: 1,
  brakeFactor: 1,
  gripFactor: 1,
  stabilityFactor: 1,
});
