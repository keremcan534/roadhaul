import { approach, clamp, clamp01, degreesToRadians, finiteOr, kmhToMetersPerSecond } from '../../core/math/scalar';
import type { VehicleDefinition } from '../../data/definitions/VehicleDefinition';
import type { Surface } from '../world/Surface';
import type { VehicleInput } from './VehicleInput';
import type { VehicleRuntimeState } from './VehicleRuntimeState';

const GRAVITY = 9.81;
const AIR_DENSITY = 1.225;
const DRIVETRAIN_EFFICIENCY = 0.85;
/** Share of the weight on the driven (rear) axle: caps traction when pulling away. */
const DRIVEN_WEIGHT_SHARE = 0.65;
/** Deceleration from engine braking while rolling in gear with the gas released, m/s². */
const ENGINE_BRAKE_DECELERATION = 0.25;
/** Below this speed (m/s) the truck counts as standing still. */
const STANDSTILL_SPEED = 0.3;
/** How long a pedal must be held at a standstill to switch between forward and reverse. */
const DIRECTION_CHANGE_DELAY_SECONDS = 0.3;
/**
 * Pedal travel up to this counts as released (a dead zone for analog input);
 * the rest of the travel is rescaled to 0..1. Everything below sees only the
 * rescaled value, so drive force, gear changes and engine braking agree on
 * whether a pedal is pressed.
 */
const PEDAL_DEAD_ZONE = 0.1;
/** Down-shifts take this fraction of an up-shift's time. */
const DOWNSHIFT_TIME_SHARE = 0.5;
/**
 * Minimum time in a gear before a down-shift. Without it, anything that slows
 * the truck during an up-shift (grass, a hill) drops the engine below the
 * down-shift speed and the gearbox hunts between two gears.
 */
const MIN_SECONDS_IN_GEAR_BEFORE_DOWNSHIFT = 1;
const RPM_PER_RADIAN_PER_SECOND = 60 / (2 * Math.PI);

/**
 * Deterministic arcade truck model (ADR 0002). It is a kinematic bicycle model
 * with a real drivetrain: torque/power curve, automatic gearbox, speed governor,
 * drag, rolling resistance, engine braking, brakes, grip-limited traction and
 * cornering, and brake-to-reverse. No tyre slip or body physics: trucks should
 * feel heavy and planted, not drift.
 *
 * Every step mutates the given state in place and allocates nothing.
 */
export class VehicleDynamics {
  private readonly radius: number;
  private readonly wheelbase: number;
  private readonly dragArea: number;
  private readonly maxTorque: number;
  private readonly maxPowerWatts: number;
  private readonly gearRatios: readonly number[];
  private readonly maxSpeed: number;
  private readonly maxReverseSpeed: number;
  private readonly maxSteerAngle: number;
  private readonly steerSpeed: number;
  private massKg: number;
  private torqueFactor = 1;
  private brakeFactor = 1;
  private engineRunning = true;
  private reverseAllowed = true;

  constructor(
    readonly definition: VehicleDefinition,
    cargoMassKg = 0,
  ) {
    const { body, powertrain, handling } = definition;
    this.radius = body.wheelRadiusMeters;
    this.wheelbase = body.wheelbaseMeters;
    this.dragArea = body.dragAreaSquareMeters;
    this.maxTorque = powertrain.maxTorqueNm;
    this.maxPowerWatts = powertrain.maxPowerKw * 1000;
    this.gearRatios = powertrain.gearRatios;
    this.maxSpeed = kmhToMetersPerSecond(definition.maxSpeedKmh);
    this.maxReverseSpeed = kmhToMetersPerSecond(handling.maxReverseSpeedKmh);
    this.maxSteerAngle = degreesToRadians(handling.maxSteerAngleDegrees);
    this.steerSpeed = degreesToRadians(handling.steerSpeedDegreesPerSecond);
    this.massKg = body.massKg + usableCargoMass(cargoMassKg);
  }

  /** Truck plus cargo. */
  get totalMassKg(): number {
    return this.massKg;
  }

  /** Loading and unloading change how the truck accelerates, brakes and corners. */
  setCargoMass(cargoMassKg: number): void {
    this.massKg = this.definition.body.massKg + usableCargoMass(cargoMassKg);
  }

  /**
   * Engine and brake strength relative to the definition (damage now,
   * upgrades later): torque and power, and brake force, are multiplied by
   * these. Unusable values count as 1.
   */
  setPerformance(torqueFactor: number, brakeFactor: number): void {
    this.torqueFactor = Math.max(0, finiteOr(torqueFactor, 1));
    this.brakeFactor = Math.max(0, finiteOr(brakeFactor, 1));
  }

  /** A stalled engine (an empty tank) drives nothing; the truck still rolls, brakes and steers. */
  setEngineRunning(running: boolean): void {
    this.engineRunning = running;
  }

  /**
   * While false, holding the brake at a standstill keeps the truck stopped
   * instead of engaging reverse (a truck standing in a loading bay).
   */
  setReverseAllowed(allowed: boolean): void {
    this.reverseAllowed = allowed;
  }

  /** A truck at rest in first gear. */
  createState(x: number, z: number, heading: number): VehicleRuntimeState {
    return {
      x,
      z,
      heading,
      speed: 0,
      steerAngle: 0,
      gear: 1,
      engineRpm: this.definition.powertrain.idleRpm,
      shiftTimer: 0,
      timeInGear: 0,
      directionChangeTimer: 0,
      longitudinalAcceleration: 0,
      lateralAcceleration: 0,
      odometerMeters: 0,
    };
  }

  /** Advances `state` by `dt` seconds. Out-of-range input is clamped; non-positive `dt` does nothing. */
  step(state: VehicleRuntimeState, input: Readonly<VehicleInput>, surface: Surface, dt: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) {
      return;
    }
    const steerInput = clamp(finiteOr(input.steer, 0), -1, 1);
    const throttle = pedalTravel(input.throttle);
    const brake = pedalTravel(input.brake);

    this.updateDirection(state, throttle, brake, dt);
    const reversing = state.gear < 0;
    // In reverse the pedals swap roles: the brake pedal drives backwards, the gas pedal brakes.
    const drivePedal = reversing ? brake : throttle;
    const brakePedal = reversing ? throttle : brake;

    this.updateEngineSpeed(state);
    this.updateGear(state, drivePedal, dt);
    this.updateSpeed(state, drivePedal, brakePedal, surface, dt);
    this.updateSteeringAndPosition(state, steerInput, surface, dt);
  }

  private updateDirection(state: VehicleRuntimeState, throttle: number, brake: number, dt: number): void {
    const standing = Math.abs(state.speed) < STANDSTILL_SPEED;
    const wantsReverse = this.reverseAllowed && state.gear > 0 && brake > 0 && throttle === 0;
    const wantsForward = state.gear < 0 && throttle > 0 && brake === 0;
    if (!standing || !(wantsReverse || wantsForward)) {
      state.directionChangeTimer = 0;
      return;
    }
    state.directionChangeTimer += dt;
    if (state.directionChangeTimer >= DIRECTION_CHANGE_DELAY_SECONDS) {
      state.gear = wantsReverse ? -1 : 1;
      state.shiftTimer = 0;
      state.timeInGear = 0;
      state.directionChangeTimer = 0;
    }
  }

  /** The engine follows the wheels; below idle the clutch slips. */
  private updateEngineSpeed(state: VehicleRuntimeState): void {
    const { idleRpm, maxRpm } = this.definition.powertrain;
    const wheelRpm = (Math.abs(state.speed) / this.radius) * RPM_PER_RADIAN_PER_SECOND;
    state.engineRpm = clamp(wheelRpm * this.totalRatio(state.gear), idleRpm, maxRpm);
  }

  private updateGear(state: VehicleRuntimeState, drivePedal: number, dt: number): void {
    state.timeInGear += dt;
    if (state.shiftTimer > 0) {
      state.shiftTimer = Math.max(0, state.shiftTimer - dt);
      return;
    }
    if (state.gear < 1) {
      return;
    }
    if (Math.abs(state.speed) < STANDSTILL_SPEED) {
      // Like a real automatic, pull away in first gear.
      if (state.gear !== 1) {
        state.gear = 1;
        state.timeInGear = 0;
      }
      return;
    }
    const { shiftUpRpm, shiftDownRpm, shiftTimeSeconds } = this.definition.powertrain;
    if (state.engineRpm > shiftUpRpm && state.gear < this.gearRatios.length && drivePedal > 0) {
      state.gear++;
      state.shiftTimer = shiftTimeSeconds;
      state.timeInGear = 0;
    } else if (
      state.engineRpm < shiftDownRpm &&
      state.gear > 1 &&
      state.timeInGear >= MIN_SECONDS_IN_GEAR_BEFORE_DOWNSHIFT
    ) {
      state.gear--;
      state.shiftTimer = shiftTimeSeconds * DOWNSHIFT_TIME_SHARE;
      state.timeInGear = 0;
    }
  }

  private updateSpeed(
    state: VehicleRuntimeState,
    drivePedal: number,
    brakePedal: number,
    surface: Surface,
    dt: number,
  ): void {
    const mass = this.massKg;
    const weight = mass * GRAVITY;
    const grip = this.definition.handling.tireGrip * surface.gripFactor;
    const reversing = state.gear < 0;

    let driveForce = 0;
    const travelSpeed = reversing ? -state.speed : state.speed;
    const speedLimit = reversing ? this.maxReverseSpeed : this.maxSpeed;
    const limiterHit = state.engineRpm >= this.definition.powertrain.maxRpm;
    if (this.engineRunning && drivePedal > 0 && state.shiftTimer <= 0 && !limiterHit && travelSpeed < speedLimit) {
      const engineAngularSpeed = state.engineRpm / RPM_PER_RADIAN_PER_SECOND;
      const torque = this.torqueFactor * Math.min(this.maxTorque, this.maxPowerWatts / engineAngularSpeed);
      const wheelForce = (drivePedal * torque * this.totalRatio(state.gear) * DRIVETRAIN_EFFICIENCY) / this.radius;
      driveForce = Math.min(wheelForce, grip * weight * DRIVEN_WEIGHT_SHARE);
    }

    const speedMagnitude = Math.abs(state.speed);
    const drag = 0.5 * AIR_DENSITY * this.dragArea * speedMagnitude * speedMagnitude;
    const rolling = surface.rollingResistance * weight;
    const engineBrake = drivePedal === 0 && speedMagnitude > STANDSTILL_SPEED ? ENGINE_BRAKE_DECELERATION * mass : 0;
    const braking = Math.min(brakePedal * this.definition.handling.brakeForceNewtons * this.brakeFactor, grip * weight);
    const resistance = drag + rolling + engineBrake + braking;

    const previousSpeed = state.speed;
    let speed = previousSpeed + ((reversing ? -driveForce : driveForce) / mass) * dt;
    // Resistance opposes motion but can never push the truck the other way.
    const slowdown = (resistance / mass) * dt;
    speed = Math.abs(speed) <= slowdown ? 0 : speed - Math.sign(speed) * slowdown;
    state.speed = clamp(speed, -this.maxReverseSpeed, this.maxSpeed);
    state.longitudinalAcceleration = (state.speed - previousSpeed) / dt;
  }

  private updateSteeringAndPosition(state: VehicleRuntimeState, steerInput: number, surface: Surface, dt: number): void {
    state.steerAngle = approach(state.steerAngle, steerInput * this.maxSteerAngle, this.steerSpeed * dt);

    // Understeer: never turn tighter than the tyres hold or the truck stays upright
    // (lateral acceleration v² · tan(angle) / wheelbase ≤ limit).
    const { tireGrip, maxLateralAccelerationG } = this.definition.handling;
    const lateralLimit = Math.min(tireGrip * surface.gripFactor, maxLateralAccelerationG) * GRAVITY;
    const speedSquared = state.speed * state.speed;
    const limitedAngle =
      speedSquared > 1e-6 ? Math.atan((lateralLimit * this.wheelbase) / speedSquared) : this.maxSteerAngle;
    const effectiveAngle = clamp(state.steerAngle, -limitedAngle, limitedAngle);

    // Kinematic bicycle model. Steering right (positive angle) turns clockwise seen from above.
    const yawRate = (-state.speed * Math.tan(effectiveAngle)) / this.wheelbase;
    state.heading += yawRate * dt;
    state.x += state.speed * Math.sin(state.heading) * dt;
    state.z += state.speed * Math.cos(state.heading) * dt;
    state.lateralAcceleration = state.speed * yawRate;
    state.odometerMeters += Math.abs(state.speed) * dt;
  }

  /** Engine revolutions per wheel revolution in `gear`. */
  private totalRatio(gear: number): number {
    const { reverseGearRatio, finalDriveRatio } = this.definition.powertrain;
    const gearRatio = gear < 0 ? reverseGearRatio : (this.gearRatios[gear - 1] ?? 1);
    return gearRatio * finalDriveRatio;
  }
}

/** Pedal input past the dead zone, 0..1. Anything unusable counts as released. */
function pedalTravel(value: number): number {
  return clamp01((clamp01(finiteOr(value, 0)) - PEDAL_DEAD_ZONE) / (1 - PEDAL_DEAD_ZONE));
}

/** Negative, NaN or infinite cargo counts as none, so a bad value cannot turn the truck's state into NaN. */
function usableCargoMass(cargoMassKg: number): number {
  return Math.max(0, finiteOr(cargoMassKg, 0));
}
