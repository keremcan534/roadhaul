import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import type { SolidContact } from '../../../../src/domain/crash/DebrisSimulation';
import { createVehicleInput } from '../../../../src/domain/vehicles/VehicleInput';
import { OnFootService } from '../../../../src/systems/driving/OnFootService';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { MemoryLogger } from '../../../support/MemoryLogger';

const STEP = 1 / 60;

/** A truck at the origin facing +z, 2.5 m wide, its circles from 1 m behind its rear axle to 7 m ahead; open ground. */
function setup() {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const driving = {
    isDriving: true,
    racing: false,
    vehicle: { x: 0, z: 0, heading: 0, speed: 0 },
    footprint: { offsets: [-1, 1, 3, 5, 7], radius: 1.25 },
    trailerFootprint: null,
    trailer: null,
    parkingBrake: false,
    setParkingBrake(applied: boolean) {
      driving.parkingBrake = applied;
    },
    world: { collideDebris: (_x: number, _z: number, _radius: number, _vx: number, _vz: number, _out: SolidContact) => false },
  };
  const service = new OnFootService(driving, events, logger);
  const said: string[] = [];
  events.on('DriverSteppedOut', () => said.push('out'));
  events.on('DriverSteppedIn', () => said.push('in'));
  /** Walks `seconds` with `throttle`, `brake` and `steer`; returns the input as the truck then gets it. */
  const walk = (seconds: number, throttle: number, steer = 0, brake = 0) => {
    const input = createVehicleInput();
    for (let t = 0; t < seconds - 1e-9; t += STEP) {
      input.throttle = throttle;
      input.brake = brake;
      input.steer = steer;
      service.update(STEP, input);
    }
    return input;
  };
  return { service, driving, events, said, walk };
}

describe('OnFootService', () => {
  it('lets the driver out only while the truck stands still, on the road, not racing', () => {
    const { service, driving } = setup();
    driving.vehicle.speed = 3;
    expect(service.stepOut()).toEqual({ ok: false, error: 'moving' });
    expect(service.mayStepOut).toBe(false);
    driving.vehicle.speed = 0;
    driving.racing = true;
    expect(service.stepOut()).toEqual({ ok: false, error: 'racing' });
    driving.racing = false;
    driving.isDriving = false;
    expect(service.stepOut()).toEqual({ ok: false, error: 'notDriving' });
    expect(service.active).toBe(false);
  });

  it("steps out by the cab door on the left, the parking brake set, and lets go of the truck's controls", () => {
    const { service, driving, said, walk } = setup();
    expect(service.mayStepOut).toBe(true);
    expect(service.stepOut()).toEqual({ ok: true, value: undefined });
    expect(said).toEqual(['out']);
    expect(service.active).toBe(true);
    expect(driving.parkingBrake).toBe(true);
    // Beside the left side (+x), at the cab: 1.25 m behind the front (7 + 1.25 m ahead).
    expect(service.walker.x).toBeCloseTo(1.25 + 0.9, 6);
    expect(service.walker.z).toBeCloseTo(7, 6);
    expect(service.nearDoor).toBe(true);
    const input = walk(1, 1);
    expect(input).toMatchObject({ throttle: 0, brake: 0, steer: 0 });
    expect(service.walker.z).toBeGreaterThan(9);
  });

  it('cannot walk through the truck', () => {
    const { service, walk } = setup();
    service.stepOut();
    // Face the truck (toward -x) and walk into it: kept clear of its side.
    service.walker.heading = -Math.PI / 2;
    walk(3, 1);
    expect(service.walker.x).toBeGreaterThanOrEqual(1.25 + 0.3 - 1e-6);
  });

  it('goes no further than the leash from the truck, and gets back in only at the door, the parking brake as it was', () => {
    const { service, driving, said, walk } = setup();
    service.stepOut();
    walk(80, 1);
    expect(Math.hypot(service.walker.x, service.walker.z)).toBeLessThanOrEqual(150 + 1e-6);
    expect(service.nearDoor).toBe(false);
    expect(service.stepIn()).toEqual({ ok: false, error: 'tooFar' });
    // Back at the door.
    service.walker.x = 2.2;
    service.walker.z = 7.4;
    expect(service.stepIn()).toEqual({ ok: true, value: undefined });
    expect(service.active).toBe(false);
    expect(driving.parkingBrake).toBe(false);
    expect(said).toEqual(['out', 'in']);
    expect(service.stepIn()).toEqual({ ok: false, error: 'notOnFoot' });
  });

  it('is back in the cab as the game leaves the road', () => {
    const { service, events, said } = setup();
    service.stepOut();
    events.emit('GameStateChanged', { previous: 'driving', current: 'mainMenu' });
    expect(service.active).toBe(false);
    expect(said).toEqual(['out', 'in']);
  });
});
