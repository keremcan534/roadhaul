import { describe, expect, it } from 'vitest';
import { Validator } from '../../../../src/core/validation/Validator';
import { VEHICLES } from '../../../../src/data/content/vehicles';
import {
  validateVehicleDefinition,
  type VehicleDefinition,
} from '../../../../src/data/definitions/VehicleDefinition';
import { vehicleFixture } from '../../../support/contentFixtures';

function issues(vehicle: VehicleDefinition): { path: string; message: string }[] {
  const validator = new Validator();
  validateVehicleDefinition(vehicle, 'vehicle', validator);
  return [...validator.issues];
}

describe('validateVehicleDefinition', () => {
  it('accepts the built-in trucks and the test fixture', () => {
    for (const vehicle of [...VEHICLES, vehicleFixture()]) {
      expect(issues(vehicle), vehicle.id).toEqual([]);
    }
  });

  it('reports missing sections instead of crashing', () => {
    const broken = { ...vehicleFixture(), body: null, powertrain: undefined } as unknown as VehicleDefinition;

    expect(issues(broken).map((issue) => issue.path)).toEqual(['vehicle.body', 'vehicle.powertrain']);
  });

  it('requires the wheelbase to fit inside the body', () => {
    const fixture = vehicleFixture();
    const vehicle = vehicleFixture({ body: { ...fixture.body, wheelbaseMeters: fixture.body.lengthMeters } });

    expect(issues(vehicle)).toEqual([
      { path: 'vehicle.body.wheelbaseMeters', message: 'must be shorter than lengthMeters' },
    ]);
  });

  it('reports every broken engine speed, not just the first', () => {
    const fixture = vehicleFixture();
    const vehicle = vehicleFixture({
      powertrain: { ...fixture.powertrain, idleRpm: -1, shiftDownRpm: Number.NaN, maxRpm: 0 },
    });

    expect(issues(vehicle).map((issue) => issue.path)).toEqual([
      'vehicle.powertrain.idleRpm',
      'vehicle.powertrain.shiftDownRpm',
      'vehicle.powertrain.maxRpm',
    ]);
  });

  it('requires engine speeds to rise from idle to the rev limiter', () => {
    const fixture = vehicleFixture();
    const vehicle = vehicleFixture({ powertrain: { ...fixture.powertrain, shiftUpRpm: 900 } });

    expect(issues(vehicle).map((issue) => issue.path)).toEqual(['vehicle.powertrain.shiftUpRpm']);
  });

  it('requires at least one gear and strictly decreasing ratios', () => {
    const fixture = vehicleFixture();
    const noGears = vehicleFixture({ powertrain: { ...fixture.powertrain, gearRatios: [] } });
    const unordered = vehicleFixture({ powertrain: { ...fixture.powertrain, gearRatios: [4, 5, 1] } });

    expect(issues(noGears)).toEqual([{ path: 'vehicle.powertrain.gearRatios', message: 'must list at least one gear' }]);
    expect(issues(unordered)).toEqual([
      { path: 'vehicle.powertrain.gearRatios', message: 'must be strictly decreasing (first gear first)' },
    ]);
  });

  it('rejects gear steps so wide that the gearbox would hunt', () => {
    const fixture = vehicleFixture();
    const vehicle = vehicleFixture({ powertrain: { ...fixture.powertrain, gearRatios: [7, 2, 1] } });

    expect(issues(vehicle)).toEqual([
      {
        path: 'vehicle.powertrain.gearRatios',
        message: 'steps are too wide for shiftUpRpm/shiftDownRpm (the gearbox would hunt)',
      },
    ]);
  });

  it('keeps steering and grip within physical ranges', () => {
    const fixture = vehicleFixture();
    const vehicle = vehicleFixture({
      handling: { ...fixture.handling, maxSteerAngleDegrees: 75, tireGrip: 3, maxLateralAccelerationG: 0 },
    });

    expect(issues(vehicle).map((issue) => issue.path)).toEqual([
      'vehicle.handling.maxSteerAngleDegrees',
      'vehicle.handling.tireGrip',
      'vehicle.handling.maxLateralAccelerationG',
    ]);
  });
});
