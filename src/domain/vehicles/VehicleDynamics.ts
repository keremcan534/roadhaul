import { approach, clamp, clamp01, degreesToRadians, finiteOr, kmhToMetersPerSecond, smoothstep } from '../../core/math/scalar';
import type { VehicleDefinition } from '../../data/definitions/VehicleDefinition';
import type { Surface } from '../world/Surface';
import { BodyMotion, type BodyBuild } from './bodyMotion';
import type { PerformanceFactors } from './performance';
import { brakePedalOf, drivePedalOf, type GearLever, type VehicleInput } from './VehicleInput';
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
 * Speed-sensitive steering: at speed the steering's full travel asks for
 * this much of the cornering limit (a little more than the tyres or the body
 * hold, so a full turn is a turn at the limit), and every bit of the travel
 * in between steers; slower, the full lock. Without it the first few percent
 * of the travel would reach the limit on the open road, and the rest do
 * nothing.
 */
const STEER_RANGE_MARGIN = 1.15;
/**
 * The steering sweeps toward the driver's input at the definition's pace at
 * walking speed, this share of it at speed (a truck's wheel is heavy, and a
 * tap of a key should not swerve it), easing in between these speeds (m/s).
 */
const HIGH_SPEED_STEER_PACE = 0.6;
const STEER_PACE_EASES_FROM = 5;
const STEER_PACE_EASES_TO = 22;
/** Letting go, the steering comes back to straight this much faster than it turns: the tyres pull it back. */
const STEER_RETURN_SPEEDUP = 1.6;
/**
 * Up to this speed (m/s, about 36 km/h) the truck corners no harder than
 * its cornering limit, well inside its rollover threshold (bodyMotion's
 * ROLLOVER_HEADROOM); from this one (about 72 km/h) its wheel turns it up
 * to RECKLESS_CORNERING times that limit, where the tyres hold, past the
 * threshold: a turn taken too fast rolls it over. Eased between.
 */
const SAFE_TURN_SPEED = 10;
const RECKLESS_TURN_SPEED = 20;
export const RECKLESS_CORNERING = 1.25;
/**
 * The tyres pull a sideways slide (a crash's shove) back to nothing over
 * about this long (seconds), and a spin beyond the path's over about this
 * long, no harder than they grip.
 */
const SLIP_RELAX_SECONDS = 0.25;
const SPIN_RELAX_SECONDS = 0.35;
/** A slide or spin this small (m/s, rad/s) has died away. */
const SLIP_REST = 1e-3;
/** Out of the wheels' hold (over, in the air), the engine revs free: this share of its range at full throttle. */
const FREE_REV_SHARE = 0.6;
/** The truck's path bends toward the front wheels' over about this long (its weight turning), seconds. */
const TURN_IN_SECONDS = 0.15;
/**
 * The pedals as the truck feels them, travel per second: the engine takes a
 * moment to pull, the air brakes to build pressure, and both let go quicker.
 * Keys and buttons press all the way at once; this makes pulling away and
 * stopping smooth, not a jolt.
 */
const THROTTLE_PRESS_RATE = 3;
const THROTTLE_RELEASE_RATE = 6;
const BRAKE_PRESS_RATE = 4;
const BRAKE_RELEASE_RATE = 8;
/** Through a gear change the clutch lets go this fast and takes up again this fast (per second): a nod, not a jolt. */
const CLUTCH_RELEASE_RATE = 10;
const CLUTCH_TAKE_UP_RATE = 3.5;

/**
 * Deterministic arcade truck model (ADR 0002). It is a kinematic bicycle model
 * with a real drivetrain: torque/power curve, automatic gearbox, speed governor,
 * drag, rolling resistance, engine braking, brakes, grip-limited traction and
 * cornering, and reverse: by brake at a standstill, or by the gear lever
 * (VehicleInput.lever). The tyres do not drift (trucks feel heavy and
 * planted): a crash's shove or spin (slipSpeed, spinRate) dies away as they
 * grip again. The steering is speed-sensitive (its whole travel steers at
 * every speed), paced, self-centring, and the path follows the wheels over a
 * moment; the pedals press in and let go smoothly. Cornering is capped by the
 * tyres, or a little past the rollover threshold: the body (BodyMotion) leans
 * on its springs, lifts its inside wheels past it and rolls over if held.
 * Over or in the air, nothing drives or steers it until it is back down.
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
  /** The steering's pace at walking speed: its whole travel per second. */
  private readonly steerPace: number;
  private massKg: number;
  private cargoMassKg: number;
  private readonly body: BodyMotion;
  private torqueFactor = 1;
  private brakeFactor = 1;
  private gripFactor = 1;
  private stabilityFactor = 1;
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
    this.steerPace = handling.steerSpeedDegreesPerSecond / handling.maxSteerAngleDegrees;
    this.cargoMassKg = usableCargoMass(cargoMassKg);
    this.massKg = body.massKg + this.cargoMassKg;
    this.body = new BodyMotion(definition, this.cargoMassKg);
  }

  /** Truck plus cargo. */
  get totalMassKg(): number {
    return this.massKg;
  }

  /** Where the truck's weight sits and how it turns, with its cargo and body strength (BodyMotion): for collisions. */
  get build(): Readonly<BodyBuild> {
    return this.body.build;
  }

  /** Loading and unloading change how the truck accelerates, brakes and corners, and how high its weight sits. */
  setCargoMass(cargoMassKg: number): void {
    this.cargoMassKg = usableCargoMass(cargoMassKg);
    this.massKg = this.definition.body.massKg + this.cargoMassKg;
    this.body.rebuild(this.cargoMassKg, this.stabilityFactor);
  }

  /**
   * Engine, brake, tyre and body strength relative to the definition (damage
   * and upgrades): torque and power, brake force, grip and the cornering
   * limit are multiplied by these. Unusable values count as 1.
   */
  setPerformance(factors: PerformanceFactors): void {
    this.torqueFactor = Math.max(0, finiteOr(factors.torqueFactor, 1));
    this.brakeFactor = Math.max(0, finiteOr(factors.brakeFactor, 1));
    this.gripFactor = Math.max(0, finiteOr(factors.gripFactor, 1));
    this.stabilityFactor = Math.max(0, finiteOr(factors.stabilityFactor, 1));
    this.body.rebuild(this.cargoMassKg, this.stabilityFactor);
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
      slipSpeed: 0,
      spinRate: 0,
      attitude: 'wheels',
      lean: 0,
      leanRate: 0,
      bank: 0,
      bankRate: 0,
      dip: 0,
      dipRate: 0,
      tilt: 0,
      tiltRate: 0,
      rise: 0,
      riseSpeed: 0,
      groundImpact: 0,
      steerPosition: 0,
      steerAngle: 0,
      pathCurvature: 0,
      throttlePedal: 0,
      brakePedal: 0,
      driveEngagement: 1,
      clutchGear: 1,
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

    const lever = input.lever ?? 'auto';
    if (state.attitude === 'airborne' || state.attitude === 'overturned') {
      this.stepLoose(state, steerInput, throttle, brake, surface, dt);
      return;
    }
    // What the driver asks for decides the direction; the pedals as they have come down so far drive and brake.
    this.updateDirection(state, throttle, brake, lever, dt);
    state.throttlePedal = approach(
      state.throttlePedal,
      throttle,
      (throttle > state.throttlePedal ? THROTTLE_PRESS_RATE : THROTTLE_RELEASE_RATE) * dt,
    );
    state.brakePedal = approach(state.brakePedal, brake, (brake > state.brakePedal ? BRAKE_PRESS_RATE : BRAKE_RELEASE_RATE) * dt);
    // On auto, in reverse the pedals swap roles; with a lever the gas drives its way and brakes against it.
    const reversing = state.gear < 0;
    const drivePedal = drivePedalOf(state.throttlePedal, state.brakePedal, lever, reversing);
    const brakePedal = brakePedalOf(state.throttlePedal, state.brakePedal, lever, reversing);

    this.updateEngineSpeed(state);
    this.updateGear(state, drivePedal, dt);
    this.updateSpeed(state, drivePedal, brakePedal, surface, dt);
    this.updateSteeringAndPosition(state, steerInput, surface, dt);
  }

  /**
   * Off its wheels (over, in the air): the pedals and the wheel still move
   * and the engine revs free, but nothing drives, brakes or steers the
   * truck; the body slides, rolls or flies on (BodyMotion).
   */
  private stepLoose(
    state: VehicleRuntimeState,
    steerInput: number,
    throttle: number,
    brake: number,
    surface: Surface,
    dt: number,
  ): void {
    state.throttlePedal = approach(state.throttlePedal, throttle, (throttle > state.throttlePedal ? THROTTLE_PRESS_RATE : THROTTLE_RELEASE_RATE) * dt);
    state.brakePedal = approach(state.brakePedal, brake, (brake > state.brakePedal ? BRAKE_PRESS_RATE : BRAKE_RELEASE_RATE) * dt);
    state.steerPosition = approach(state.steerPosition, steerInput, this.steerPace * dt);
    state.steerAngle = state.steerPosition * this.maxSteerAngle;
    state.directionChangeTimer = 0;
    state.shiftTimer = 0;
    const { idleRpm, maxRpm } = this.definition.powertrain;
    state.engineRpm = this.engineRunning ? idleRpm + state.throttlePedal * FREE_REV_SHARE * (maxRpm - idleRpm) : idleRpm;
    this.body.stepLoose(state, surface, dt);
  }

  private updateDirection(
    state: VehicleRuntimeState,
    throttle: number,
    brake: number,
    lever: GearLever,
    dt: number,
  ): void {
    const standing = Math.abs(state.speed) < STANDSTILL_SPEED;
    if (lever !== 'auto') {
      // At a standstill the gearbox follows the lever at once.
      state.directionChangeTimer = 0;
      const wantsReverse = lever === 'reverse' && this.reverseAllowed && state.gear > 0;
      const wantsForward = lever === 'drive' && state.gear < 0;
      if (standing && (wantsReverse || wantsForward)) {
        state.gear = wantsReverse ? -1 : 1;
        state.shiftTimer = 0;
        state.timeInGear = 0;
      }
      return;
    }
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
      state.clutchGear = state.gear;
      state.gear++;
      state.shiftTimer = shiftTimeSeconds;
      state.timeInGear = 0;
    } else if (
      state.engineRpm < shiftDownRpm &&
      state.gear > 1 &&
      state.timeInGear >= MIN_SECONDS_IN_GEAR_BEFORE_DOWNSHIFT
    ) {
      state.clutchGear = state.gear;
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
    const grip = this.definition.handling.tireGrip * this.gripFactor * surface.gripFactor;
    const reversing = state.gear < 0;

    let driveForce = 0;
    const travelSpeed = reversing ? -state.speed : state.speed;
    const speedLimit = reversing ? this.maxReverseSpeed : this.maxSpeed;
    const limiterHit = state.engineRpm >= this.definition.powertrain.maxRpm;
    // Through a gear change the clutch lets go of the gear being left, then takes up the new one.
    const shifting = state.shiftTimer > 0;
    if (!shifting) {
      state.clutchGear = state.gear;
    }
    state.driveEngagement = approach(state.driveEngagement, shifting ? 0 : 1, (shifting ? CLUTCH_RELEASE_RATE : CLUTCH_TAKE_UP_RATE) * dt);
    if (this.engineRunning && drivePedal > 0 && state.driveEngagement > 0 && !limiterHit && travelSpeed < speedLimit) {
      const engineAngularSpeed = state.engineRpm / RPM_PER_RADIAN_PER_SECOND;
      const torque = this.torqueFactor * Math.min(this.maxTorque, this.maxPowerWatts / engineAngularSpeed);
      const wheelForce =
        (drivePedal * state.driveEngagement * torque * this.totalRatio(state.clutchGear) * DRIVETRAIN_EFFICIENCY) /
        this.radius;
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

  /** The wheel angle that turns the truck at `lateral` m/s² at a speed of √`speedSquared`; the lock at a standstill. */
  private angleFor(lateral: number, speedSquared: number): number {
    return speedSquared > 1e-6 ? Math.atan((lateral * this.wheelbase) / speedSquared) : this.maxSteerAngle;
  }

  private updateSteeringAndPosition(state: VehicleRuntimeState, steerInput: number, surface: Surface, dt: number): void {
    // The steering follows the driver: slower at speed, and back toward straight faster than it turns.
    const pace =
      this.steerPace *
      (1 - (1 - HIGH_SPEED_STEER_PACE) * smoothstep(STEER_PACE_EASES_FROM, STEER_PACE_EASES_TO, Math.abs(state.speed)));
    const returning = Math.abs(steerInput) < Math.abs(state.steerPosition) || steerInput * state.steerPosition < 0;
    state.steerPosition = approach(state.steerPosition, steerInput, (returning ? pace * STEER_RETURN_SPEEDUP : pace) * dt);

    // The sharpest the truck may turn (lateral acceleration v² · tan(angle) / wheelbase ≤ limit): no tighter than
    // the tyres hold, nor at town speeds past its cornering limit, well inside its rollover threshold (bodyMotion),
    // so a junction taken on full lock leans it hard but keeps it on its wheels. Faster, the tyres hold it up to the
    // threshold: a turn taken too fast, or a swerve, lifts its inside wheels and can roll it over.
    const speedSquared = state.speed * state.speed;
    const grip = this.definition.handling.tireGrip * this.gripFactor * surface.gripFactor * GRAVITY;
    const corner = this.definition.handling.maxLateralAccelerationG * this.stabilityFactor * GRAVITY;
    const reckless = smoothstep(SAFE_TURN_SPEED, RECKLESS_TURN_SPEED, Math.abs(state.speed));
    const lateralLimit = Math.min(grip, corner * (1 + (RECKLESS_CORNERING - 1) * reckless));
    const limitedAngle = this.angleFor(lateralLimit, speedSquared);
    // Speed-sensitive: the steering's whole travel spans the lock at walking pace, the cornering limit (and a
    // little) in town, and on the open road as hard as the tyres may turn the truck.
    const travel = Math.min(grip, corner * (1 + (RECKLESS_CORNERING / STEER_RANGE_MARGIN - 1) * reckless));
    state.steerAngle = state.steerPosition * Math.min(this.maxSteerAngle, this.angleFor(travel, speedSquared) * STEER_RANGE_MARGIN);
    // Understeer: past the limit the wheels turn but the truck does not turn tighter.
    const effectiveAngle = clamp(state.steerAngle, -limitedAngle, limitedAngle);

    // Kinematic bicycle model whose path bends toward the wheels' over a moment. Steering right (positive
    // angle) turns clockwise seen from above.
    const wheelCurvature = Math.tan(effectiveAngle) / this.wheelbase;
    const limitCurvature = Math.tan(limitedAngle) / this.wheelbase;
    state.pathCurvature = clamp(
      state.pathCurvature + (wheelCurvature - state.pathCurvature) * (1 - Math.exp(-dt / TURN_IN_SECONDS)),
      -limitCurvature,
      limitCurvature,
    );
    // A crash's spin turns the truck under its motion (the rear axle slides sideways as it turns); the slide and
    // the spin die away as the tyres grip, no faster than their grip allows. The grip's pull is what the truck feels.
    const slipBefore = state.slipSpeed;
    state.slipSpeed -= state.speed * state.spinRate * dt;
    if (state.slipSpeed !== 0) {
      const pull = state.slipSpeed * (1 - Math.exp(-dt / SLIP_RELAX_SECONDS));
      state.slipSpeed -= clamp(pull, -grip * dt, grip * dt);
      if (Math.abs(state.slipSpeed) < SLIP_REST) {
        state.slipSpeed = 0;
      }
    }
    if (state.spinRate !== 0) {
      const { halfWheelbase, yawGyration } = this.body.build;
      const spinGrip = (grip * halfWheelbase) / yawGyration;
      const pull = state.spinRate * (1 - Math.exp(-dt / SPIN_RELAX_SECONDS));
      state.spinRate -= clamp(pull, -spinGrip * dt, spinGrip * dt);
      if (Math.abs(state.spinRate) < SLIP_REST) {
        state.spinRate = 0;
      }
    }
    const yawRate = -state.speed * state.pathCurvature + state.spinRate;
    state.heading += yawRate * dt;
    const sin = Math.sin(state.heading);
    const cos = Math.cos(state.heading);
    state.x += (state.speed * sin + state.slipSpeed * cos) * dt;
    state.z += (state.speed * cos - state.slipSpeed * sin) * dt;
    state.lateralAcceleration = state.speed * yawRate + (state.slipSpeed - slipBefore) / dt;
    state.odometerMeters += Math.abs(state.speed) * dt;
    this.body.stepGrounded(state, dt);
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
