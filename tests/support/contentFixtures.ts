import type { CargoDefinition } from '../../src/data/definitions/CargoDefinition';
import type { CityDefinition } from '../../src/data/definitions/CityDefinition';
import type { MissionDefinition } from '../../src/data/definitions/MissionDefinition';
import type { VehicleDefinition } from '../../src/data/definitions/VehicleDefinition';
import type { GameContent } from '../../src/data/GameContent';

/** Small, valid definitions for tests. Override only the fields a test is about. */

export function vehicleFixture(overrides: Partial<VehicleDefinition> = {}): VehicleDefinition {
  return {
    id: 'test_truck',
    vehicleClass: 'medium',
    maxPayloadTons: 10,
    fuelCapacityLiters: 300,
    baseFuelLitersPerKm: 0.3,
    maxSpeedKmh: 90,
    body: {
      massKg: 8000,
      lengthMeters: 9,
      widthMeters: 2.5,
      heightMeters: 3.6,
      wheelbaseMeters: 5,
      wheelRadiusMeters: 0.5,
      dragAreaSquareMeters: 6,
    },
    powertrain: {
      maxTorqueNm: 1200,
      maxPowerKw: 220,
      idleRpm: 600,
      maxRpm: 2400,
      shiftUpRpm: 2000,
      shiftDownRpm: 1100,
      gearRatios: [7, 4.2, 2.6, 1.7, 1.2, 0.9],
      reverseGearRatio: 6.5,
      finalDriveRatio: 4,
      shiftTimeSeconds: 0.4,
    },
    handling: {
      maxSteerAngleDegrees: 35,
      steerSpeedDegreesPerSecond: 80,
      brakeForceNewtons: 70000,
      tireGrip: 0.85,
      maxReverseSpeedKmh: 12,
    },
    ...overrides,
  };
}

export function cargoFixture(overrides: Partial<CargoDefinition> = {}): CargoDefinition {
  return {
    id: 'test_cargo',
    category: 'food',
    rewardMultiplier: 1,
    damageSensitivity: 0.5,
    timeSensitivity: 0.5,
    temperature: 'none',
    ...overrides,
  };
}

export function cityFixture(overrides: Partial<CityDefinition> = {}): CityDefinition {
  return { id: 'test_origin', specialization: 'starter', ...overrides };
}

export function missionFixture(overrides: Partial<MissionDefinition> = {}): MissionDefinition {
  return {
    id: 'test_mission',
    originCityId: 'test_origin',
    destinationCityId: 'test_destination',
    cargoId: 'test_cargo',
    cargoWeightTons: 5,
    baseReward: 1000,
    timeLimitSeconds: 600,
    damageTolerance: 0.2,
    difficulty: 'easy',
    ...overrides,
  };
}

export function contentFixture(overrides: Partial<GameContent> = {}): GameContent {
  return {
    vehicles: [vehicleFixture()],
    cargo: [cargoFixture()],
    cities: [cityFixture(), cityFixture({ id: 'test_destination', specialization: 'industrial' })],
    missions: [missionFixture()],
    ...overrides,
  };
}
