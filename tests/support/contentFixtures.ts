import type { CargoDefinition } from '../../src/data/definitions/CargoDefinition';
import type { CityDefinition } from '../../src/data/definitions/CityDefinition';
import type { MapDefinition } from '../../src/data/definitions/MapDefinition';
import type { MissionDefinition } from '../../src/data/definitions/MissionDefinition';
import type { TrafficVehicleDefinition } from '../../src/data/definitions/TrafficVehicleDefinition';
import type { UpgradeDefinition } from '../../src/data/definitions/UpgradeDefinition';
import type { VehicleDefinition } from '../../src/data/definitions/VehicleDefinition';
import type { GameContent } from '../../src/data/GameContent';

/** Small, valid definitions for tests. Override only the fields a test is about. */

export function vehicleFixture(overrides: Partial<VehicleDefinition> = {}): VehicleDefinition {
  return {
    id: 'test_truck',
    vehicleClass: 'medium',
    bodyType: 'box',
    maxPayloadTons: 10,
    fuelCapacityLiters: 300,
    baseFuelLitersPerKm: 0.3,
    maxSpeedKmh: 90,
    purchasePrice: 20000,
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
      maxLateralAccelerationG: 0.4,
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
    requiredBody: 'box',
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

/**
 * A straight, open 300 m road along the X axis (z = 0, 10 m wide), a building
 * north of its middle, a depot south of the road at each end (the fixture
 * mission's origin in the west, its destination in the east) and the truck
 * spawning at the origin facing +X.
 */
export function mapFixture(overrides: Partial<MapDefinition> = {}): MapDefinition {
  return {
    id: 'test_map',
    halfSizeMeters: 200,
    roads: [
      {
        id: 'test_road',
        kind: 'street',
        widthMeters: 10,
        closed: false,
        controlPoints: [
          [-150, 0],
          [150, 0],
        ],
      },
    ],
    buildings: [{ x: 0, z: 40, widthMeters: 20, depthMeters: 10, heightMeters: 5 }],
    depots: [
      {
        id: 'test_origin_depot',
        cityId: 'test_origin',
        yard: { x: -100, z: -17, headingDegrees: 90, lengthMeters: 44, widthMeters: 26 },
        bay: { x: -100, z: -17, headingDegrees: 90, lengthMeters: 16, widthMeters: 4.6 },
      },
      {
        id: 'test_destination_depot',
        cityId: 'test_destination',
        yard: { x: 100, z: -17, headingDegrees: 90, lengthMeters: 44, widthMeters: 26 },
        bay: { x: 100, z: -17, headingDegrees: 90, lengthMeters: 16, widthMeters: 4.6 },
      },
    ],
    restAreas: [],
    spawn: { x: 0, z: 0, headingDegrees: 90 },
    scenery: { seed: 1, treesPerKilometer: 0 },
    ...overrides,
  };
}

export function contentFixture(overrides: Partial<GameContent> = {}): GameContent {
  return {
    vehicles: [vehicleFixture()],
    cargo: [cargoFixture()],
    cities: [cityFixture(), cityFixture({ id: 'test_destination', specialization: 'industrial' })],
    missions: [missionFixture()],
    maps: [mapFixture()],
    upgrades: [upgradeFixture()],
    trafficVehicles: [trafficVehicleFixture()],
    ...overrides,
  };
}

export function trafficVehicleFixture(overrides: Partial<TrafficVehicleDefinition> = {}): TrafficVehicleDefinition {
  return {
    id: 'test_car',
    kind: 'car',
    lengthMeters: 4,
    widthMeters: 1.8,
    heightMeters: 1.5,
    cruiseSpeedFactor: 1,
    accelerationMetersPerSecondSquared: 2,
    spawnWeight: 1,
    colors: [0xff0000],
    ...overrides,
  };
}

/** Two levels: +10 % engine power, then +20 % from company level 2. */
export function upgradeFixture(overrides: Partial<UpgradeDefinition> = {}): UpgradeDefinition {
  return {
    id: 'test_upgrade',
    levels: [
      { cost: 1000, modifiers: [{ stat: 'enginePower', bonus: 0.1 }] },
      { cost: 2000, requiredCompanyLevel: 2, modifiers: [{ stat: 'enginePower', bonus: 0.2 }] },
    ],
    ...overrides,
  };
}
