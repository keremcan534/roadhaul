import type { VehicleDefinition } from '../definitions/VehicleDefinition';

/**
 * Truck roster (spec §15): three original designs, one per class. Never use
 * real manufacturer names, logos or designs.
 *
 * - H1: the light box truck every company starts with.
 * - H2: a medium refrigerated truck for chilled and frozen cargo, and heavier boxes.
 * - H3: a heavy flatbed for building materials.
 *
 * The driving numbers are tuned against the per-class behaviour ranges in
 * tests/unit/domain/vehicles/vehicleTuning.test.ts.
 */
export const VEHICLES: readonly VehicleDefinition[] = [
  {
    id: 'rh_h1',
    vehicleClass: 'light',
    bodyType: 'box',
    maxPayloadTons: 5,
    fuelCapacityLiters: 150,
    baseFuelLitersPerKm: 0.2,
    maxSpeedKmh: 90,
    purchasePrice: 12000,
    body: {
      massKg: 4200,
      lengthMeters: 7.4,
      widthMeters: 2.45,
      heightMeters: 3.3,
      wheelbaseMeters: 4.2,
      wheelRadiusMeters: 0.42,
      dragAreaSquareMeters: 5,
    },
    powertrain: {
      maxTorqueNm: 600,
      maxPowerKw: 130,
      idleRpm: 700,
      maxRpm: 2700,
      shiftUpRpm: 2250,
      shiftDownRpm: 1250,
      gearRatios: [5.8, 3.5, 2.2, 1.45, 1, 0.78],
      reverseGearRatio: 5.3,
      finalDriveRatio: 4.3,
      shiftTimeSeconds: 0.4,
    },
    handling: {
      maxSteerAngleDegrees: 38,
      steerSpeedDegreesPerSecond: 90,
      brakeForceNewtons: 38000,
      tireGrip: 0.7,
      maxLateralAccelerationG: 0.45,
      maxReverseSpeedKmh: 15,
    },
  },
  {
    id: 'rh_h2',
    vehicleClass: 'medium',
    bodyType: 'refrigerated',
    maxPayloadTons: 10,
    fuelCapacityLiters: 250,
    baseFuelLitersPerKm: 0.28,
    maxSpeedKmh: 90,
    purchasePrice: 22000,
    requiredCompanyLevel: 2,
    body: {
      massKg: 7500,
      lengthMeters: 9.2,
      widthMeters: 2.5,
      heightMeters: 3.7,
      wheelbaseMeters: 5.2,
      wheelRadiusMeters: 0.48,
      dragAreaSquareMeters: 6.2,
    },
    powertrain: {
      maxTorqueNm: 1150,
      maxPowerKw: 210,
      idleRpm: 650,
      maxRpm: 2600,
      shiftUpRpm: 2150,
      shiftDownRpm: 1200,
      gearRatios: [6.5, 3.9, 2.45, 1.6, 1.15, 0.85],
      reverseGearRatio: 5.9,
      finalDriveRatio: 4.1,
      shiftTimeSeconds: 0.45,
    },
    handling: {
      maxSteerAngleDegrees: 37,
      steerSpeedDegreesPerSecond: 80,
      brakeForceNewtons: 64000,
      tireGrip: 0.72,
      maxLateralAccelerationG: 0.4,
      maxReverseSpeedKmh: 13,
    },
  },
  {
    id: 'rh_h3',
    vehicleClass: 'heavy',
    bodyType: 'flatbed',
    maxPayloadTons: 18,
    fuelCapacityLiters: 400,
    baseFuelLitersPerKm: 0.36,
    maxSpeedKmh: 85,
    purchasePrice: 38000,
    requiredCompanyLevel: 3,
    body: {
      massKg: 11000,
      lengthMeters: 10.5,
      widthMeters: 2.55,
      heightMeters: 3.3,
      wheelbaseMeters: 6,
      wheelRadiusMeters: 0.52,
      dragAreaSquareMeters: 6.5,
    },
    powertrain: {
      maxTorqueNm: 1800,
      maxPowerKw: 290,
      idleRpm: 600,
      maxRpm: 2400,
      shiftUpRpm: 1900,
      shiftDownRpm: 1100,
      gearRatios: [7.2, 4.6, 3, 2, 1.4, 1, 0.78],
      reverseGearRatio: 6.8,
      finalDriveRatio: 4,
      shiftTimeSeconds: 0.5,
    },
    handling: {
      maxSteerAngleDegrees: 36,
      steerSpeedDegreesPerSecond: 70,
      brakeForceNewtons: 90000,
      tireGrip: 0.72,
      maxLateralAccelerationG: 0.36,
      maxReverseSpeedKmh: 12,
    },
  },
];
