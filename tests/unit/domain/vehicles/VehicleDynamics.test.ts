import { describe, expect, it } from 'vitest';
import { VehicleDynamics } from '../../../../src/domain/vehicles/VehicleDynamics';
import { ASPHALT, GRASS } from '../../../../src/domain/world/Surface';
import { vehicleFixture } from '../../../support/contentFixtures';
import { drive, input, kmh, STEP_SECONDS } from '../../../support/driving';

const truck = vehicleFixture();

function setup(cargoMassKg = 0) {
  const dynamics = new VehicleDynamics(truck, cargoMassKg);
  return { dynamics, state: dynamics.createState(0, 0, 0) };
}

describe('VehicleDynamics', () => {
  it('starts at rest in first gear at idle', () => {
    const { state } = setup();

    expect(state).toMatchObject({ speed: 0, gear: 1, engineRpm: truck.powertrain.idleRpm, steerAngle: 0 });
  });

  it('pulls away and shifts up through every gear under full throttle', () => {
    const { dynamics, state } = setup();
    const gearsSeen = new Set<number>();

    for (let i = 0; i < 60 * 60; i++) {
      dynamics.step(state, input({ throttle: 1 }), ASPHALT, STEP_SECONDS);
      gearsSeen.add(state.gear);
    }

    expect(state.speed).toBeGreaterThan(0);
    expect([...gearsSeen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('never exceeds the speed governor', () => {
    const { dynamics, state } = setup();

    drive(dynamics, state, input({ throttle: 1 }), 120);

    expect(kmh(state)).toBeLessThanOrEqual(truck.maxSpeedKmh + 1e-9);
    expect(kmh(state)).toBeGreaterThan(truck.maxSpeedKmh - 1);
  });

  it('coasts to a stop without rolling backwards', () => {
    const { dynamics, state } = setup();
    drive(dynamics, state, input({ throttle: 1 }), 10);

    drive(dynamics, state, input(), 300);

    expect(state.speed).toBe(0);
    expect(state.gear).toBe(1);
  });

  it('holds a standstill briefly, then engages reverse while the brake stays pressed', () => {
    const { dynamics, state } = setup();
    drive(dynamics, state, input({ throttle: 1 }), 5);
    drive(dynamics, state, input({ brake: 1 }), 30, { until: (current) => current.speed === 0 });

    drive(dynamics, state, input({ brake: 1 }), 0.2);
    expect(state.gear).toBe(1);
    expect(state.speed).toBe(0);
    const stoppedAtZ = state.z;

    drive(dynamics, state, input({ brake: 1 }), 10);
    expect(state.gear).toBe(-1);
    expect(kmh(state)).toBeLessThan(-truck.handling.maxReverseSpeedKmh + 0.1);
    expect(kmh(state)).toBeGreaterThanOrEqual(-truck.handling.maxReverseSpeedKmh);
    expect(state.z).toBeLessThan(stoppedAtZ - 20);
  });

  it('brakes with the gas pedal while reversing, then switches back to forward', () => {
    const { dynamics, state } = setup();
    drive(dynamics, state, input({ brake: 1 }), 5);
    expect(state.gear).toBe(-1);

    drive(dynamics, state, input({ throttle: 1 }), 30, { until: (current) => current.speed === 0 });
    expect(state.gear).toBe(-1);

    drive(dynamics, state, input({ throttle: 1 }), 3);
    expect(state.gear).toBeGreaterThan(0);
    expect(state.speed).toBeGreaterThan(0);
  });

  it('turns right (clockwise from above) when steering right, and left when steering left', () => {
    const right = setup();
    const left = setup();

    drive(right.dynamics, right.state, input({ throttle: 0.5, steer: 1 }), 3);
    drive(left.dynamics, left.state, input({ throttle: 0.5, steer: -1 }), 3);

    expect(right.state.heading).toBeLessThan(0);
    expect(right.state.x).toBeLessThan(0);
    expect(left.state.heading).toBeGreaterThan(0);
    expect(left.state.x).toBeGreaterThan(0);
  });

  it('turns the front wheels gradually toward the requested angle', () => {
    const { dynamics, state } = setup();
    const maxAngle = (truck.handling.maxSteerAngleDegrees * Math.PI) / 180;
    const perStep = ((truck.handling.steerSpeedDegreesPerSecond * Math.PI) / 180) * STEP_SECONDS;

    dynamics.step(state, input({ steer: 1 }), ASPHALT, STEP_SECONDS);
    expect(state.steerAngle).toBeCloseTo(perStep, 9);

    drive(dynamics, state, input({ steer: 1 }), 5);
    expect(state.steerAngle).toBeCloseTo(maxAngle, 9);
  });

  it('turns no tighter than the steering lock allows at walking pace', () => {
    const { dynamics, state } = setup();
    const expectedRadius = truck.body.wheelbaseMeters / Math.tan((truck.handling.maxSteerAngleDegrees * Math.PI) / 180);
    drive(dynamics, state, input({ steer: 1 }), 2);

    // Hold 2 m/s and measure the circle the truck drives.
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < 60 * 40; i++) {
      state.speed = 2;
      dynamics.step(state, input({ steer: 1 }), ASPHALT, STEP_SECONDS);
      state.speed = 2;
      minX = Math.min(minX, state.x);
      maxX = Math.max(maxX, state.x);
    }

    expect((maxX - minX) / 2).toBeCloseTo(expectedRadius, 1);
  });

  it('caps the lateral acceleration at the stability limit at speed', () => {
    const { dynamics, state } = setup();
    drive(dynamics, state, input({ throttle: 1 }), 60);
    let peak = 0;

    for (let i = 0; i < 180; i++) {
      dynamics.step(state, input({ throttle: 1, steer: 1 }), ASPHALT, STEP_SECONDS);
      peak = Math.max(peak, Math.abs(state.lateralAcceleration));
    }

    expect(peak).toBeLessThanOrEqual(truck.handling.maxLateralAccelerationG * 9.81 + 1e-9);
    expect(peak).toBeGreaterThan(truck.handling.maxLateralAccelerationG * 9.81 * 0.95);
  });

  it('accelerates more slowly with cargo on board', () => {
    const empty = setup();
    const loaded = setup(truck.maxPayloadTons * 1000);
    const toFifty = { until: (state: { speed: number }) => state.speed * 3.6 >= 50 };

    const emptyTime = drive(empty.dynamics, empty.state, input({ throttle: 1 }), 120, toFifty);
    const loadedTime = drive(loaded.dynamics, loaded.state, input({ throttle: 1 }), 120, toFifty);

    expect(loaded.dynamics.totalMassKg).toBe(truck.body.massKg + truck.maxPayloadTons * 1000);
    expect(loadedTime).toBeGreaterThan(emptyTime * 1.3);
  });

  it('is slower on grass than on asphalt', () => {
    const road = setup();
    const field = setup();

    drive(road.dynamics, road.state, input({ throttle: 1 }), 30);
    drive(field.dynamics, field.state, input({ throttle: 1 }), 30, { surface: GRASS });

    expect(field.state.speed).toBeLessThan(road.state.speed * 0.8);
  });

  it('does not hunt between gears when something slows the truck during a shift', () => {
    const { dynamics, state } = setup();
    let downshiftsUnderThrottle = 0;

    for (let i = 0; i < 60 * 30; i++) {
      const gearBefore = state.gear;
      dynamics.step(state, input({ throttle: 1 }), GRASS, STEP_SECONDS);
      if (state.gear < gearBefore) {
        downshiftsUnderThrottle++;
      }
    }

    expect(downshiftsUnderThrottle).toBe(0);
    expect(state.gear).toBeGreaterThan(2);
  });

  it('selects first gear again after stopping', () => {
    const { dynamics, state } = setup();
    drive(dynamics, state, input({ throttle: 1 }), 20);
    expect(state.gear).toBeGreaterThan(3);

    drive(dynamics, state, input({ brake: 1 }), 30, { until: (current) => current.speed === 0 });
    dynamics.step(state, input(), ASPHALT, STEP_SECONDS);

    expect(state.gear).toBe(1);
  });

  it('is deterministic', () => {
    const a = setup();
    const b = setup();
    const script = [input({ throttle: 1 }), input({ throttle: 0.6, steer: 0.4 }), input({ brake: 0.7, steer: -1 })];

    for (const step of script) {
      drive(a.dynamics, a.state, step, 4);
      drive(b.dynamics, b.state, step, 4);
    }

    expect(a.state).toEqual(b.state);
  });

  it('ignores unusable time steps and clamps unusable input', () => {
    const { dynamics, state } = setup();
    const before = { ...state };

    dynamics.step(state, input({ throttle: 1 }), ASPHALT, 0);
    dynamics.step(state, input({ throttle: 1 }), ASPHALT, -1);
    dynamics.step(state, input({ throttle: 1 }), ASPHALT, Number.NaN);
    dynamics.step(state, input({ throttle: 1 }), ASPHALT, Number.POSITIVE_INFINITY);
    expect(state).toEqual(before);

    drive(dynamics, state, input({ throttle: 50, steer: Number.NaN, brake: -3 }), 2);
    expect(Number.isFinite(state.x) && Number.isFinite(state.z) && Number.isFinite(state.heading)).toBe(true);
    expect(state.speed).toBeGreaterThan(0);
    expect(state.steerAngle).toBe(0);
  });
});
