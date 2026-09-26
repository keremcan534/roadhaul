import type { TrafficVehicleDefinition } from '../definitions/TrafficVehicleDefinition';

/**
 * The region's traffic (spec §19): generic, original shapes in everyday
 * colours. Cars are most common; buses are rare.
 */
export const TRAFFIC_VEHICLES: readonly TrafficVehicleDefinition[] = [
  {
    id: 'compact_car',
    kind: 'car',
    lengthMeters: 4.3,
    widthMeters: 1.8,
    heightMeters: 1.5,
    cruiseSpeedFactor: 1,
    accelerationMetersPerSecondSquared: 2.2,
    spawnWeight: 5,
    colors: [0xc7372f, 0x2f5fa8, 0xb9bec4, 0xeeeeea, 0x3a3f45, 0x3f7a4a, 0xe0b235],
  },
  {
    id: 'saloon_car',
    kind: 'car',
    carBody: 'saloon',
    lengthMeters: 4.7,
    widthMeters: 1.82,
    heightMeters: 1.46,
    cruiseSpeedFactor: 1.05,
    accelerationMetersPerSecondSquared: 2.4,
    spawnWeight: 4,
    colors: [0x1f2a44, 0x151719, 0xa9aeb4, 0xf2f2ee, 0x6b1f2a, 0x4a5a6a],
  },
  {
    id: 'minibus',
    kind: 'minibus',
    lengthMeters: 6.6,
    widthMeters: 2.1,
    heightMeters: 2.6,
    cruiseSpeedFactor: 0.93,
    accelerationMetersPerSecondSquared: 1.6,
    spawnWeight: 2,
    colors: [0xf0efe8, 0xe8d9b0, 0x5d86b8],
  },
  {
    id: 'delivery_truck',
    kind: 'truck',
    lengthMeters: 8,
    widthMeters: 2.4,
    heightMeters: 3.2,
    cruiseSpeedFactor: 0.85,
    accelerationMetersPerSecondSquared: 1.1,
    spawnWeight: 2,
    colors: [0x7a8b99, 0x9c4a2f, 0x2e6a73],
  },
  {
    id: 'city_bus',
    kind: 'bus',
    lengthMeters: 11.5,
    widthMeters: 2.5,
    heightMeters: 3.1,
    cruiseSpeedFactor: 0.8,
    accelerationMetersPerSecondSquared: 1,
    spawnWeight: 1,
    colors: [0x2d7dd2, 0xe07b24],
  },
];
