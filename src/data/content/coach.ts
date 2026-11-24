import type { VehicleDefinition } from '../definitions/VehicleDefinition';

/**
 * The coach stations' coach (the owner's bus job): an original twelve-metre
 * coach, lent for each run of a coach line and never sold or kept (it is
 * not one of the dealer's VEHICLES). Driven from a coach station
 * (MapDefinition.places, kind `busStation`) through the towns' bus stops.
 * Heavier and softer than the trucks of its size: it carries people.
 */
export const COACH: VehicleDefinition = {
  id: 'rh_coach',
  vehicleClass: 'heavy',
  factoryColor: 0x1f8a70,
  bodyType: 'box',
  maxPayloadTons: 4,
  fuelCapacityLiters: 300,
  baseFuelLitersPerKm: 0.3,
  maxSpeedKmh: 100,
  purchasePrice: 0,
  body: {
    massKg: 13500,
    lengthMeters: 12,
    widthMeters: 2.55,
    heightMeters: 3.4,
    wheelbaseMeters: 6.1,
    wheelRadiusMeters: 0.5,
    dragAreaSquareMeters: 6.8,
  },
  powertrain: {
    maxTorqueNm: 1600,
    maxPowerKw: 260,
    idleRpm: 600,
    maxRpm: 2500,
    shiftUpRpm: 2050,
    shiftDownRpm: 1150,
    gearRatios: [5.9, 3.6, 2.3, 1.55, 1.12, 0.84],
    reverseGearRatio: 5.4,
    finalDriveRatio: 3.9,
    shiftTimeSeconds: 0.4,
  },
  handling: {
    maxSteerAngleDegrees: 40,
    steerSpeedDegreesPerSecond: 80,
    brakeForceNewtons: 105000,
    tireGrip: 0.74,
    maxLateralAccelerationG: 0.52,
    maxReverseSpeedKmh: 12,
  },
};
