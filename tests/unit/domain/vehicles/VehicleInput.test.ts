import { describe, expect, it } from 'vitest';
import { combineVehicleInputs, createVehicleInput } from '../../../../src/domain/vehicles/VehicleInput';

describe('combineVehicleInputs', () => {
  it('adds steering and keeps the stronger pedal press', () => {
    const out = createVehicleInput();

    combineVehicleInputs(out, { steer: 0.5, throttle: 0.2, brake: 0 }, { steer: 0.25, throttle: 0.8, brake: 0.3 });

    expect(out).toEqual({ steer: 0.75, throttle: 0.8, brake: 0.3 });
  });

  it('clamps the result and ignores non-finite values', () => {
    const out = createVehicleInput();

    combineVehicleInputs(out, { steer: 1, throttle: 3, brake: Number.NaN }, { steer: 1, throttle: 0, brake: -2 });

    expect(out).toEqual({ steer: 1, throttle: 1, brake: 0 });
  });

  it('writes into the given object instead of allocating', () => {
    const out = createVehicleInput();

    expect(combineVehicleInputs(out, createVehicleInput(), createVehicleInput())).toBe(out);
  });
});
