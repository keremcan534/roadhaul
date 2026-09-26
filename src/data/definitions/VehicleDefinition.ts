import type { Validator } from '../../core/validation/Validator';
import type { Credits } from '../units';
import { BODY_TYPES, type BodyType } from './BodyType';

export const VEHICLE_CLASSES = ['light', 'medium', 'heavy'] as const;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

/**
 * Static description of a truck model: the spec's VehicleDefinition
 * ScriptableObject. It holds everything the driving model needs, so a new
 * truck is added as data only (spec §49).
 *
 * Per-truck runtime state (fuel level, damage, upgrades) lives in the domain
 * layer and refers to a definition by `id`.
 */
export interface VehicleDefinition {
  /** Stable snake_case id. It is written into save files: never rename it. */
  readonly id: string;
  readonly vehicleClass: VehicleClass;
  /** What the load travels in; decides which cargo the truck can take (see bodyCanHaul). */
  readonly bodyType: BodyType;
  readonly maxPayloadTons: number;
  readonly fuelCapacityLiters: number;
  /** Consumption of the empty truck on flat road (spec §17 `vehicle.baseFuelPerKm`). */
  readonly baseFuelLitersPerKm: number;
  /** Speed governor: the truck never drives faster than this. */
  readonly maxSpeedKmh: number;
  /** What the garage sells it for (spec §15). The starting truck is free with a new company. */
  readonly purchasePrice: Credits;
  /** The company level that lets the garage sell it. Omit for level 1. */
  readonly requiredCompanyLevel?: number;
  /** The colour it leaves the dealer in, 0xRRGGBB; the garage can paint it another (PaintDefinition). */
  readonly factoryColor: number;
  readonly body: VehicleBody;
  readonly powertrain: VehiclePowertrain;
  readonly handling: VehicleHandling;
}

/** Size and mass. The visual model and the collision shape are derived from these. */
export interface VehicleBody {
  /** Unladen mass. Cargo mass is added while driving. */
  readonly massKg: number;
  readonly lengthMeters: number;
  readonly widthMeters: number;
  readonly heightMeters: number;
  /** Distance between the front and rear axle; with the steering angle it sets the turning circle. */
  readonly wheelbaseMeters: number;
  readonly wheelRadiusMeters: number;
  /** Drag coefficient × frontal area. */
  readonly dragAreaSquareMeters: number;
}

/** Engine and automatic gearbox. */
export interface VehiclePowertrain {
  readonly maxTorqueNm: number;
  /** Above the speed where torque × speed reaches this, the engine is power-limited. */
  readonly maxPowerKw: number;
  readonly idleRpm: number;
  /** Rev limiter. */
  readonly maxRpm: number;
  /** The automatic gearbox shifts up above this engine speed... */
  readonly shiftUpRpm: number;
  /** ...and down below this one. */
  readonly shiftDownRpm: number;
  /** Forward gears, first gear first (strictly decreasing). */
  readonly gearRatios: readonly number[];
  readonly reverseGearRatio: number;
  readonly finalDriveRatio: number;
  /** Drive is interrupted for this long while changing gear. */
  readonly shiftTimeSeconds: number;
}

export interface VehicleHandling {
  /** The front wheels' full lock, at walking pace; faster, the steering's travel spans less (VehicleDynamics). */
  readonly maxSteerAngleDegrees: number;
  /** How fast the front wheels turn toward the requested angle at walking pace; the steering is heavier at speed. */
  readonly steerSpeedDegreesPerSecond: number;
  /** Total brake force at full pedal (also limited by tyre grip). */
  readonly brakeForceNewtons: number;
  /** Tyre-road friction coefficient on dry asphalt; limits traction and braking. */
  readonly tireGrip: number;
  /**
   * Cornering limit in g. A tall truck would tip over long before its tyres
   * slide (roughly 0.35 g heavy, 0.45 g light), so turns are capped here.
   */
  readonly maxLateralAccelerationG: number;
  readonly maxReverseSpeedKmh: number;
}

export function validateVehicleDefinition(vehicle: VehicleDefinition, path: string, validator: Validator): void {
  validator.id(vehicle.id, `${path}.id`);
  validator.oneOf(vehicle.vehicleClass, VEHICLE_CLASSES, `${path}.vehicleClass`);
  validator.oneOf(vehicle.bodyType, BODY_TYPES, `${path}.bodyType`);
  validator.positiveNumber(vehicle.maxPayloadTons, `${path}.maxPayloadTons`);
  validator.positiveNumber(vehicle.fuelCapacityLiters, `${path}.fuelCapacityLiters`);
  validator.positiveNumber(vehicle.baseFuelLitersPerKm, `${path}.baseFuelLitersPerKm`);
  validator.positiveNumber(vehicle.maxSpeedKmh, `${path}.maxSpeedKmh`);
  validator.nonNegativeInteger(vehicle.purchasePrice, `${path}.purchasePrice`);
  if (vehicle.requiredCompanyLevel !== undefined) {
    validator.positiveInteger(vehicle.requiredCompanyLevel, `${path}.requiredCompanyLevel`);
  }
  validator.check(
    Number.isInteger(vehicle.factoryColor) && vehicle.factoryColor >= 0 && vehicle.factoryColor <= 0xffffff,
    `${path}.factoryColor`,
    'must be a colour, 0x000000 to 0xffffff',
  );
  validateBody(vehicle.body, `${path}.body`, validator);
  validatePowertrain(vehicle.powertrain, `${path}.powertrain`, validator);
  validateHandling(vehicle.handling, `${path}.handling`, validator);
}

function validateBody(body: VehicleBody, path: string, validator: Validator): void {
  if (!validator.check(typeof body === 'object' && body !== null, path, 'must be an object')) {
    return;
  }
  validator.positiveNumber(body.massKg, `${path}.massKg`);
  validator.positiveNumber(body.lengthMeters, `${path}.lengthMeters`);
  validator.positiveNumber(body.widthMeters, `${path}.widthMeters`);
  validator.positiveNumber(body.heightMeters, `${path}.heightMeters`);
  if (validator.positiveNumber(body.wheelbaseMeters, `${path}.wheelbaseMeters`)) {
    validator.check(
      body.wheelbaseMeters < body.lengthMeters,
      `${path}.wheelbaseMeters`,
      'must be shorter than lengthMeters',
    );
  }
  validator.positiveNumber(body.wheelRadiusMeters, `${path}.wheelRadiusMeters`);
  validator.positiveNumber(body.dragAreaSquareMeters, `${path}.dragAreaSquareMeters`);
}

function validatePowertrain(powertrain: VehiclePowertrain, path: string, validator: Validator): void {
  if (!validator.check(typeof powertrain === 'object' && powertrain !== null, path, 'must be an object')) {
    return;
  }
  validator.positiveNumber(powertrain.maxTorqueNm, `${path}.maxTorqueNm`);
  validator.positiveNumber(powertrain.maxPowerKw, `${path}.maxPowerKw`);
  const rpms = [powertrain.idleRpm, powertrain.shiftDownRpm, powertrain.shiftUpRpm, powertrain.maxRpm];
  const rpmNames = ['idleRpm', 'shiftDownRpm', 'shiftUpRpm', 'maxRpm'];
  // map() before every(): check all four, so every broken one is reported.
  const rpmsPositive = rpms
    .map((rpm, index) => validator.positiveNumber(rpm, `${path}.${rpmNames[index]}`))
    .every(Boolean);
  const rpmsValid =
    rpmsPositive &&
    validator.check(
      rpms.every((rpm, index) => index === 0 || rpm > (rpms[index - 1] ?? 0)),
      `${path}.shiftUpRpm`,
      'engine speeds must rise: idleRpm < shiftDownRpm < shiftUpRpm < maxRpm',
    );
  const gears = powertrain.gearRatios;
  if (validator.check(Array.isArray(gears) && gears.length > 0, `${path}.gearRatios`, 'must list at least one gear')) {
    gears.forEach((ratio, index) => validator.positiveNumber(ratio, `${path}.gearRatios[${index}]`));
    const decreasing = validator.check(
      gears.every((ratio, index) => index === 0 || ratio < (gears[index - 1] ?? 0)),
      `${path}.gearRatios`,
      'must be strictly decreasing (first gear first)',
    );
    // After an up-shift the engine must stay above shiftDownRpm, or the gearbox would hunt between two gears.
    if (decreasing && rpmsValid) {
      const hunts = gears.some(
        (ratio, index) => index > 0 && powertrain.shiftUpRpm * (ratio / (gears[index - 1] ?? ratio)) <= powertrain.shiftDownRpm,
      );
      validator.check(!hunts, `${path}.gearRatios`, 'steps are too wide for shiftUpRpm/shiftDownRpm (the gearbox would hunt)');
    }
  }
  validator.positiveNumber(powertrain.reverseGearRatio, `${path}.reverseGearRatio`);
  validator.positiveNumber(powertrain.finalDriveRatio, `${path}.finalDriveRatio`);
  validator.check(
    Number.isFinite(powertrain.shiftTimeSeconds) && powertrain.shiftTimeSeconds >= 0 && powertrain.shiftTimeSeconds < 2,
    `${path}.shiftTimeSeconds`,
    'must be from 0 to 2 seconds',
  );
}

function validateHandling(handling: VehicleHandling, path: string, validator: Validator): void {
  if (!validator.check(typeof handling === 'object' && handling !== null, path, 'must be an object')) {
    return;
  }
  validator.check(
    Number.isFinite(handling.maxSteerAngleDegrees) &&
      handling.maxSteerAngleDegrees > 0 &&
      handling.maxSteerAngleDegrees < 60,
    `${path}.maxSteerAngleDegrees`,
    'must be greater than 0 and less than 60',
  );
  validator.positiveNumber(handling.steerSpeedDegreesPerSecond, `${path}.steerSpeedDegreesPerSecond`);
  validator.positiveNumber(handling.brakeForceNewtons, `${path}.brakeForceNewtons`);
  validator.check(
    Number.isFinite(handling.tireGrip) && handling.tireGrip > 0 && handling.tireGrip <= 1.5,
    `${path}.tireGrip`,
    'must be greater than 0 and at most 1.5',
  );
  validator.check(
    Number.isFinite(handling.maxLateralAccelerationG) &&
      handling.maxLateralAccelerationG > 0 &&
      handling.maxLateralAccelerationG <= 1.5,
    `${path}.maxLateralAccelerationG`,
    'must be greater than 0 and at most 1.5',
  );
  validator.positiveNumber(handling.maxReverseSpeedKmh, `${path}.maxReverseSpeedKmh`);
}
