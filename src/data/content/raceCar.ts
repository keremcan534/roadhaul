import type { VehicleDefinition } from '../definitions/VehicleDefinition';

/**
 * The race clubs' car (the owner's car races): an original two-seat sports
 * car, light and quick, lent for each race and never sold or kept (it is
 * not one of the dealer's VEHICLES). Raced on the streets from a race club
 * (MapDefinition.places, kind `raceClub`) against three of the club's cars.
 */
export const RACE_CAR: VehicleDefinition = {
  id: 'rh_sprint',
  vehicleClass: 'light',
  factoryColor: 0xe8663d,
  bodyType: 'box',
  maxPayloadTons: 0.2,
  fuelCapacityLiters: 60,
  baseFuelLitersPerKm: 0.09,
  maxSpeedKmh: 185,
  purchasePrice: 0,
  body: {
    massKg: 1250,
    lengthMeters: 4.3,
    widthMeters: 1.85,
    heightMeters: 1.25,
    wheelbaseMeters: 2.6,
    wheelRadiusMeters: 0.33,
    dragAreaSquareMeters: 0.62,
  },
  powertrain: {
    maxTorqueNm: 420,
    maxPowerKw: 240,
    idleRpm: 850,
    maxRpm: 7400,
    shiftUpRpm: 6800,
    shiftDownRpm: 3400,
    gearRatios: [3.4, 2.3, 1.7, 1.3, 1.05, 0.86],
    reverseGearRatio: 3.2,
    finalDriveRatio: 3.7,
    shiftTimeSeconds: 0.18,
  },
  handling: {
    maxSteerAngleDegrees: 34,
    steerSpeedDegreesPerSecond: 240,
    brakeForceNewtons: 15000,
    tireGrip: 1.05,
    maxLateralAccelerationG: 0.95,
    maxReverseSpeedKmh: 25,
  },
};
