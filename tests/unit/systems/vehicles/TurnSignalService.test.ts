import { describe, expect, it } from 'vitest';
import { VEHICLES } from '../../../../src/data/content/vehicles';
import { createVehicleInput } from '../../../../src/domain/vehicles/VehicleInput';
import { VehicleDynamics } from '../../../../src/domain/vehicles/VehicleDynamics';
import { ASPHALT } from '../../../../src/domain/world/Surface';
import { TurnSignalService } from '../../../../src/systems/vehicles/TurnSignalService';

describe('TurnSignalService', () => {
  it('flashes the side switched on, cancels after the turn, and starts a new drive with everything off', () => {
    const signals = new TurnSignalService();
    signals.toggle('left');
    expect(signals.mode).toBe('left');
    expect(signals.leftLit).toBe(true);
    expect(signals.rightLit).toBe(false);
    // Turning left at a junction, 5 m/s round a 10 m radius (left: negative), and straightening up again.
    const truck = { steerPosition: -0.8, pathCurvature: -0.1, speed: 5 };
    for (let i = 0; i < 120; i++) signals.update(1 / 60, truck);
    expect(signals.mode).toBe('left');
    truck.steerPosition = 0;
    truck.pathCurvature = 0;
    for (let i = 0; i < 30; i++) signals.update(1 / 60, truck);
    expect(signals.mode).toBe('off');

    signals.toggleHazard();
    expect(signals.leftLit && signals.rightLit).toBe(true);
    signals.reset();
    expect(signals.mode).toBe('off');
    expect(signals.leftLit || signals.rightLit).toBe(false);
  });

  it('reads a real truck: a right turn at a junction cancels the right signal, a lane change on the open road does not', () => {
    const truck = VEHICLES[0]!;
    const dynamics = new VehicleDynamics(truck);
    const signals = new TurnSignalService();
    const input = createVehicleInput();
    const drive = (seconds: number, steer: number, throttle: number, brake = 0): void => {
      input.steer = steer;
      input.throttle = throttle;
      input.brake = brake;
      for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
        dynamics.step(state, input, ASPHALT, 1 / 60);
        signals.update(1 / 60, state);
      }
    };
    const state = dynamics.createState(0, 0, 0);
    // Up to town speed, the right signal on, round the corner on full lock and out of it.
    drive(4, 0, 0.6);
    signals.toggle('right');
    drive(5, 1, 0.25);
    expect(signals.mode).toBe('right');
    drive(2, 0, 0.3);
    expect(signals.mode).toBe('off');

    // On the open road: a lane change to the left with the left signal on, which stays on.
    drive(20, 0, 1);
    expect(state.speed).toBeGreaterThan(15);
    signals.toggle('left');
    drive(1.2, -0.5, 1);
    drive(1.2, 0.5, 1);
    drive(1, 0, 1);
    expect(signals.mode).toBe('left');
  });
});
