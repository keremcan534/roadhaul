import type { VehicleDefinition } from '../definitions/VehicleDefinition';

/**
 * Truck roster. Models are original designs (spec §15): never use real
 * manufacturer names, logos or designs. The MVP adds H2 (medium) and H3 (heavy).
 *
 * The driving numbers are tuned against the behaviour ranges in
 * tests/unit/domain/vehicles/vehicleTuning.test.ts.
 */
export const VEHICLES: readonly VehicleDefinition[] = [
  {
    id: 'rh_h1',
    vehicleClass: 'light',
    maxPayloadTons: 5,
    fuelCapacityLiters: 150,
    baseFuelLitersPerKm: 0.2,
    maxSpeedKmh: 90,
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
];
