import { describe, expect, it } from 'vitest';
import {
  CARGO_ROLLOVER_LOSS,
  createBodyBuild,
  DIP_AT_LIFT,
  footprintBuild,
  kickBody,
  LEAN_AT_LIFT,
  rideUp,
} from '../../../../src/domain/vehicles/bodyMotion';
import { createVehicleFootprint } from '../../../../src/domain/vehicles/VehicleFootprint';
import type { VehicleInput } from '../../../../src/domain/vehicles/VehicleInput';
import type { VehicleRuntimeState } from '../../../../src/domain/vehicles/VehicleRuntimeState';
import { ROLLOVER_MARGIN, VehicleDynamics } from '../../../../src/domain/vehicles/VehicleDynamics';
import { ASPHALT } from '../../../../src/domain/world/Surface';
import { vehicleFixture } from '../../../support/contentFixtures';
import { input, STEP_SECONDS } from '../../../support/driving';

const truck = vehicleFixture();
const G = 9.81;

/** A truck rolling at `kmh` along +z. */
function rolling(kmh: number) {
  const dynamics = new VehicleDynamics(truck);
  const state = dynamics.createState(0, 0, 0);
  state.speed = kmh / 3.6;
  return { dynamics, state };
}

/**
 * Steps `seconds` with the input `plan(t)` gives, keeping the speed up while the truck is on its wheels (a driver
 * holding it); calls `watch` after every step. Returns the attitudes seen, in order, each once.
 */
function run(
  dynamics: VehicleDynamics,
  state: VehicleRuntimeState,
  seconds: number,
  plan: (t: number) => Partial<VehicleInput>,
  options: { holdSpeed?: number; watch?: (state: VehicleRuntimeState) => void } = {},
): string[] {
  const seen: string[] = [];
  for (let step = 0; step < Math.round(seconds / STEP_SECONDS); step++) {
    if (options.holdSpeed !== undefined && (state.attitude === 'wheels' || state.attitude === 'tipping')) {
      state.speed = options.holdSpeed;
    }
    dynamics.step(state, input(plan(step * STEP_SECONDS)), ASPHALT, STEP_SECONDS);
    options.watch?.(state);
    if (seen.at(-1) !== state.attitude) {
      seen.push(state.attitude);
    }
  }
  return seen;
}

describe('the body in motion', () => {
  it('sits the weight as high as makes a rigid truck tip at its threshold: higher loaded, lower with a stiffer body', () => {
    const empty = createBodyBuild(truck);
    const threshold = truck.handling.maxLateralAccelerationG;
    expect(empty.rolloverAcceleration).toBeCloseTo(threshold * G, 9);
    expect(empty.cogHeight).toBeCloseTo(truck.body.widthMeters / 2 / threshold, 9);
    expect(empty.cogAhead).toBe(truck.body.wheelbaseMeters / 2);

    // A steadier truck, loaded: its weight well inside its body either way.
    const steady = vehicleFixture({ handling: { ...truck.handling, maxLateralAccelerationG: 0.55 } });
    const unloaded = createBodyBuild(steady);
    const loaded = createBodyBuild(steady, steady.maxPayloadTons * 1000);
    expect(loaded.rolloverAcceleration).toBeCloseTo(0.55 * (1 - CARGO_ROLLOVER_LOSS) * G, 9);
    expect(loaded.cogHeight).toBeGreaterThan(unloaded.cogHeight);
    // Past the payload counts as the payload; nonsense as none.
    expect(createBodyBuild(steady, 1e9).cogHeight).toBeCloseTo(loaded.cogHeight, 9);
    expect(createBodyBuild(steady, Number.NaN).cogHeight).toBe(unloaded.cogHeight);
    // The weight never sits above nine tenths of the body: a truck that tall tips a little later than it says.
    const top = createBodyBuild(truck, truck.maxPayloadTons * 1000);
    expect(top.cogHeight).toBeCloseTo(truck.body.heightMeters * 0.9, 9);
    expect(top.rolloverAcceleration).toBeCloseTo((G * top.halfWidth) / top.cogHeight, 9);

    const stiff = createBodyBuild(truck, 0, 1.15);
    expect(stiff.rolloverAcceleration).toBeCloseTo(threshold * 1.15 * G, 9);
    expect(stiff.cogHeight).toBeLessThan(empty.cogHeight);

    // The truck's dynamics carry its build, and move it with the load.
    const dynamics = new VehicleDynamics(steady);
    expect(dynamics.build).toEqual(unloaded);
    dynamics.setCargoMass(steady.maxPayloadTons * 1000);
    expect(dynamics.build.cogHeight).toBeCloseTo(loaded.cogHeight, 9);
  });

  it('makes a plausible build from a footprint alone', () => {
    const footprint = createVehicleFootprint(truck.body);
    const build = footprintBuild(footprint.offsets, footprint.radius);

    expect(build.halfWidth).toBe(footprint.radius);
    expect(build.halfLength).toBeCloseTo(truck.body.lengthMeters / 2, 9);
    expect(build.cogAhead).toBeCloseTo(truck.body.wheelbaseMeters / 2, 9);
    expect(build.rolloverAcceleration).toBeCloseTo((G * build.halfWidth) / build.cogHeight, 9);
  });

  it('leans the body out of a steady turn on its springs, in step with the turn, without lifting a wheel', () => {
    const { dynamics, state } = rolling(60);
    state.steerPosition = 0.3;
    let lifted = false;

    run(dynamics, state, 4, () => ({ steer: 0.3 }), { holdSpeed: 60 / 3.6, watch: (now) => (lifted ||= now.attitude !== 'wheels') });

    // Turning right, it leans left (its left side down): the lean at lift, times the share of the threshold.
    const share = state.lateralAcceleration / (truck.handling.maxLateralAccelerationG * G);
    expect(share).toBeLessThan(-0.3);
    expect(share).toBeGreaterThan(-0.7);
    expect(state.lean).toBeCloseTo(LEAN_AT_LIFT * share, 3);
    expect(lifted).toBe(false);
    expect(state).toMatchObject({ bank: 0, tilt: 0, rise: 0 });
  });

  it('lifts its inside wheels at the limit, and comes back down on them when the turn eases', () => {
    const { dynamics, state } = rolling(60);
    let landing = 0;

    const seen = run(dynamics, state, 4, (t) => ({ steer: t < 1 ? 1 : 0 }), {
      holdSpeed: 60 / 3.6,
      watch: (now) => (landing = Math.max(landing, now.groundImpact)),
    });

    expect(seen).toEqual(['wheels', 'tipping', 'wheels']);
    // Up on its left wheels (turning right), then down with a thump.
    expect(landing).toBeGreaterThan(0);
    expect(state).toMatchObject({ bank: 0, bankRate: 0 });
  });

  it('rolls over when the turn is held, onto its outer side, and slides to a stop there, out of the driver\'s hands', () => {
    const { dynamics, state } = rolling(60);
    let slam = 0;

    const seen = run(dynamics, state, 6, () => ({ steer: 1 }), {
      holdSpeed: 60 / 3.6,
      watch: (now) => (slam = Math.max(slam, now.groundImpact)),
    });

    expect(seen.slice(0, 3)).toEqual(['wheels', 'tipping', 'overturned']);
    expect(seen.at(-1)).toBe('overturned');
    // On its left side (it turned right), resting, its weight low.
    expect(Math.abs(state.bank)).toBeGreaterThan(Math.PI / 2 - 0.01);
    expect(state.bank).toBeLessThan(0);
    expect(slam).toBeGreaterThan(2);
    run(dynamics, state, 10, () => ({}));
    expect(state.speed).toBe(0);
    expect(state.rise).toBeLessThan(0);

    // Gas and steering do nothing now.
    const { x, z, heading } = state;
    run(dynamics, state, 2, () => ({ throttle: 1, steer: -1 }));
    expect(state).toMatchObject({ x, z, heading, speed: 0, attitude: 'overturned' });
  });

  it('rolls over in a hard swerve that a gentle lane change only leans through', () => {
    const swerve = rolling(70);
    const fishhook = run(swerve.dynamics, swerve.state, 5, (t) => ({ steer: t < 1 ? 1 : t < 2.3 ? -1 : 0 }), {
      holdSpeed: 70 / 3.6,
    });
    expect(fishhook).toContain('overturned');
    // It went over the way the second turn threw it: right, onto its right side.
    expect(swerve.state.bank).toBeGreaterThan(0);

    const change = rolling(90);
    let lean = 0;
    const laneChange = run(change.dynamics, change.state, 5, (t) => ({ steer: t < 1 ? 0.3 : t < 2 ? -0.3 : 0 }), {
      holdSpeed: 90 / 3.6,
      watch: (now) => (lean = Math.max(lean, Math.abs(now.lean))),
    });
    expect(laneChange).toEqual(['wheels']);
    expect(lean).toBeGreaterThan(LEAN_AT_LIFT * 0.2);
    expect(lean).toBeLessThan(LEAN_AT_LIFT * 0.8);
  });

  it('trips over a sideways slide as its tyres grip again, rolling the way it slid', () => {
    const { dynamics, state } = rolling(80);
    state.slipSpeed = -12; // Sliding to its right.
    let bank = 0;

    const seen = run(dynamics, state, 6, () => ({}), { watch: (now) => (bank = Math.max(bank, now.bank)) });

    expect(seen).toContain('overturned');
    // Over onto its right side (at least), the grip of each landing edge taking the slide off it.
    expect(bank).toBeGreaterThan(Math.PI / 2 - 0.01);
    expect(state.slipSpeed).toBe(0);
    expect(state.speed).toBeLessThan(80 / 3.6 / 2);
  });

  it('rocks away from a low sideways blow, and a hard one knocks it over', () => {
    for (const [blow, over] of [
      [3, false],
      [9, true],
    ] as const) {
      const { dynamics, state } = rolling(40);
      // Shoved to its left from low down: its top lags, it rolls right first.
      state.slipSpeed += blow;
      kickBody(state, dynamics.build, 0, blow);
      expect(state.leanRate).toBeGreaterThan(0);

      const seen = run(dynamics, state, 6, () => ({}));

      expect(seen.includes('overturned'), `a ${blow} m/s blow`).toBe(over);
    }
  });

  it('lifts its rear in a hard head-on blow, and drops back onto its wheels', () => {
    const { dynamics, state } = rolling(72);
    let tilt = 0;
    // A wall stops it dead and bounces it back a little: pushed back low down, its nose dips over its front wheels.
    const change = -1.1 * state.speed;
    state.speed += change;
    kickBody(state, dynamics.build, change, 0);

    const seen = run(dynamics, state, 4, () => ({}), { watch: (now) => (tilt = Math.max(tilt, now.tilt)) });

    // Up on its front wheels (then its bumper), back down, rocking; never over.
    expect(seen).toContain('tipping');
    expect(seen).not.toContain('overturned');
    expect(seen.at(-1)).toBe('wheels');
    expect(tilt).toBeGreaterThan(0.1);
    expect(state).toMatchObject({ tilt: 0, tiltRate: 0, bank: 0, rise: 0 });
  });

  it('is thrown up driving over a wreck, flies nose up, and lands back on its wheels', () => {
    const { dynamics, state } = rolling(60);
    let peak = 0;
    let noseUp = 0;
    let landing = 0;
    rideUp(state, 16, 0);
    // A gentle knock does not throw it higher than a hard one already has.
    const riseSpeed = state.riseSpeed;
    rideUp(state, 1, 0);
    expect(state.riseSpeed).toBe(riseSpeed);

    const seen = run(dynamics, state, 3, () => ({ throttle: 0.5 }), {
      watch: (now) => {
        peak = Math.max(peak, now.rise);
        noseUp = Math.min(noseUp, now.tilt + now.dip);
        landing = Math.max(landing, now.groundImpact);
      },
    });

    expect(seen[0]).toBe('airborne');
    expect(seen.at(-1)).toBe('wheels');
    expect(peak).toBeGreaterThan(0.1);
    expect(noseUp).toBeLessThan(-0.03);
    expect(landing).toBeGreaterThan(1);
  });

  it('keeps plain driving on its wheels: level going straight, no stoppie braking hard', () => {
    const { dynamics, state } = rolling(0);
    let dip = 0;
    let stopped = false;
    // Flat out, then full brakes until it stops (held on, they would back it up).
    const seen = run(dynamics, state, 20, (t) => (t < 12 ? { throttle: 1 } : stopped ? {} : { brake: 1 }), {
      watch: (now) => {
        dip = Math.max(dip, Math.abs(now.dip));
        stopped ||= now.speed === 0 && now.gear > 0;
      },
    });

    expect(seen).toEqual(['wheels']);
    expect(state.speed).toBe(0);
    expect(dip).toBeGreaterThan(DIP_AT_LIFT * 0.3);
    expect(dip).toBeLessThan(DIP_AT_LIFT);
    expect(state).toMatchObject({ lean: 0, bank: 0, tilt: 0, rise: 0, slipSpeed: 0, spinRate: 0 });
  });

  it('corners a stiffer truck harder before its wheels lift', () => {
    const liftSpeed = (stability: number): number => {
      const dynamics = new VehicleDynamics(truck);
      dynamics.setPerformance({ torqueFactor: 1, brakeFactor: 1, gripFactor: 1, stabilityFactor: stability });
      const state = dynamics.createState(0, 0, 0);
      state.speed = 60 / 3.6;
      let lateral = 0;
      run(dynamics, state, 3, () => ({ steer: 1 }), {
        holdSpeed: 60 / 3.6,
        watch: (now) => {
          if (now.attitude === 'wheels') lateral = Math.max(lateral, Math.abs(now.lateralAcceleration));
        },
      });
      return lateral;
    };
    expect(liftSpeed(1.15)).toBeGreaterThan(liftSpeed(1) * 1.1);
    expect(liftSpeed(1)).toBeLessThanOrEqual(truck.handling.maxLateralAccelerationG * ROLLOVER_MARGIN * G + 1e-9);
  });

  it('is deterministic', () => {
    const play = () => {
      const { dynamics, state } = rolling(80);
      state.slipSpeed = 9;
      kickBody(state, dynamics.build, -3, 9);
      rideUp(state, 12, 0.5);
      run(dynamics, state, 5, (t) => ({ steer: Math.sin(t * 3), throttle: 0.5 }));
      return state;
    };

    expect(play()).toEqual(play());
  });
});
