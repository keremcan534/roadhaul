import { describe, expect, it } from 'vitest';
import { Validator } from '../../../../src/core/validation/Validator';
import { TRAFFIC_VEHICLES } from '../../../../src/data/content/trafficVehicles';
import {
  TRAFFIC_VEHICLE_KINDS,
  validateTrafficVehicleDefinition,
  type TrafficVehicleDefinition,
} from '../../../../src/data/definitions/TrafficVehicleDefinition';
import { trafficVehicleFixture } from '../../../support/contentFixtures';

function issues(vehicle: TrafficVehicleDefinition): string[] {
  const validator = new Validator();
  validateTrafficVehicleDefinition(vehicle, 'vehicle', validator);
  return validator.issues.map((issue) => issue.path);
}

describe('validateTrafficVehicleDefinition', () => {
  it('accepts the built-in traffic and the test fixture', () => {
    for (const vehicle of [...TRAFFIC_VEHICLES, trafficVehicleFixture()]) {
      expect(issues(vehicle), vehicle.id).toEqual([]);
    }
  });

  it('ships every kind of traffic spec §19 asks for, cars the most common and buses the rarest', () => {
    expect(new Set(TRAFFIC_VEHICLES.map((vehicle) => vehicle.kind))).toEqual(new Set(TRAFFIC_VEHICLE_KINDS));
    const weightOf = (kind: string): number =>
      TRAFFIC_VEHICLES.filter((vehicle) => vehicle.kind === kind).reduce((sum, vehicle) => sum + vehicle.spawnWeight, 0);
    expect(weightOf('car')).toBeGreaterThan(weightOf('minibus'));
    expect(weightOf('bus')).toBeLessThan(weightOf('truck'));
    // Nothing is wider than a lane of the narrowest road (8 m country roads: 4 m lanes) allows.
    for (const vehicle of TRAFFIC_VEHICLES) {
      expect(vehicle.widthMeters, vehicle.id).toBeLessThanOrEqual(2.6);
      expect(vehicle.lengthMeters, vehicle.id).toBeLessThanOrEqual(12);
    }
  });

  it('reports sizes, speeds, weights and colours out of range', () => {
    const vehicle = trafficVehicleFixture({
      id: 'Bad Car',
      kind: 'tank' as TrafficVehicleDefinition['kind'],
      lengthMeters: 0,
      widthMeters: -1,
      heightMeters: Number.NaN,
      cruiseSpeedFactor: 1.5,
      accelerationMetersPerSecondSquared: 0,
      spawnWeight: -2,
      colors: [0x1000000],
    });

    expect(issues(vehicle)).toEqual([
      'vehicle.id',
      'vehicle.kind',
      'vehicle.lengthMeters',
      'vehicle.widthMeters',
      'vehicle.heightMeters',
      'vehicle.cruiseSpeedFactor',
      'vehicle.accelerationMetersPerSecondSquared',
      'vehicle.spawnWeight',
      'vehicle.colors',
    ]);
    expect(issues(trafficVehicleFixture({ colors: [] }))).toEqual(['vehicle.colors']);
  });
});
