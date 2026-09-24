import { describe, expect, it } from 'vitest';
import {
  brakePedalOf,
  combineVehicleInputs,
  createVehicleInput,
  drivePedalOf,
} from '../../../../src/domain/vehicles/VehicleInput';

describe('combineVehicleInputs', () => {
  it('adds steering and keeps the stronger pedal press', () => {
    const out = createVehicleInput();

    combineVehicleInputs(out, { steer: 0.5, throttle: 0.2, brake: 0 }, { steer: 0.25, throttle: 0.8, brake: 0.3 });

    expect(out).toEqual({ steer: 0.75, throttle: 0.8, brake: 0.3, lever: 'auto' });
  });

  it('clamps the result and ignores non-finite values', () => {
    const out = createVehicleInput();

    combineVehicleInputs(out, { steer: 1, throttle: 3, brake: Number.NaN }, { steer: 1, throttle: 0, brake: -2 });

    expect(out).toEqual({ steer: 1, throttle: 1, brake: 0, lever: 'auto' });
  });

  it('writes into the given object instead of allocating', () => {
    const out = createVehicleInput();

    expect(combineVehicleInputs(out, createVehicleInput(), createVehicleInput())).toBe(out);
  });

  it('takes the gear lever of the device being driven, else one that is set', () => {
    const out = createVehicleInput();
    const keyboard = createVehicleInput();
    const touch = { ...createVehicleInput(), lever: 'reverse' as const };

    // Nothing pressed: the touch lever counts.
    expect(combineVehicleInputs(out, keyboard, touch).lever).toBe('reverse');
    // The keyboard's brake pressed: its own way (brake to reverse) counts.
    keyboard.brake = 1;
    expect(combineVehicleInputs(out, keyboard, touch).lever).toBe('auto');
    // The touch gas pressed too: both pressed, the lever that is set wins.
    touch.throttle = 1;
    expect(combineVehicleInputs(out, keyboard, touch).lever).toBe('reverse');
    // A lever left out counts as auto.
    expect(combineVehicleInputs(out, { steer: 0, throttle: 0, brake: 0 }, createVehicleInput()).lever).toBe('auto');
  });

  it('reads the pedals the way the truck does: swapped in reverse on auto, the gas driving the lever\'s way', () => {
    // Auto: forward, gas drives; in reverse the brake drives and the gas brakes.
    expect([drivePedalOf(0.6, 0.2, 'auto', false), brakePedalOf(0.6, 0.2, 'auto', false)]).toEqual([0.6, 0.2]);
    expect([drivePedalOf(0.6, 0.2, undefined, true), brakePedalOf(0.6, 0.2, undefined, true)]).toEqual([0.2, 0.6]);
    // A lever: the gas drives its way, the brake brakes.
    expect([drivePedalOf(0.6, 0.2, 'reverse', true), brakePedalOf(0.6, 0.2, 'reverse', true)]).toEqual([0.6, 0.2]);
    expect([drivePedalOf(0.6, 0.2, 'drive', false), brakePedalOf(0.6, 0.2, 'drive', false)]).toEqual([0.6, 0.2]);
    // Still rolling against the lever: the gas brakes too, and nothing drives.
    expect([drivePedalOf(0.6, 0.2, 'reverse', false), brakePedalOf(0.6, 0.2, 'reverse', false)]).toEqual([0, 0.6]);
  });
});
