import { describe, expect, it } from 'vitest';
import { AutoPilot, type PilotLimits, type PilotRoad, type PilotRoute } from '../../../../src/domain/vehicles/autoPilot';
import { VehicleDynamics } from '../../../../src/domain/vehicles/VehicleDynamics';
import { createVehicleInput } from '../../../../src/domain/vehicles/VehicleInput';
import type { VehicleRuntimeState } from '../../../../src/domain/vehicles/VehicleRuntimeState';
import { ASPHALT } from '../../../../src/domain/world/Surface';
import { vehicleFixture } from '../../../support/contentFixtures';
import { STEP_SECONDS } from '../../../support/driving';

const truck = vehicleFixture();
const ROADS: readonly PilotRoad[] = [{ kind: 'rural', widthMeters: 7 }];
/** A rural road's right-hand lane lies this far right of its middle. */
const LANE = 1.75;
const BEND_RADIUS = 30;

/** The road's middle: 300 m along +z, a right-hand bend of 30 m radius, then 200 m along −x; a sample every 2 m. */
function roadMiddle(): { x: number[]; z: number[] } {
  const x: number[] = [];
  const z: number[] = [];
  for (let s = 0; s <= 300; s += 2) {
    x.push(0);
    z.push(s);
  }
  // Turning right from +z is turning toward −x: round the centre (−30, 300).
  for (let a = 0.05; a < Math.PI / 2; a += 0.05) {
    x.push(-BEND_RADIUS + BEND_RADIUS * Math.cos(a));
    z.push(300 + BEND_RADIUS * Math.sin(a));
  }
  for (let s = 0; s <= 200; s += 2) {
    x.push(-BEND_RADIUS - s);
    z.push(300 + BEND_RADIUS);
  }
  return { x, z };
}

/** The route as navigation hands it over: from the sample nearest the truck on, measured from there. */
function routeFrom(middle: { x: number[]; z: number[] }, truckX: number, truckZ: number): PilotRoute {
  let nearest = 0;
  for (let k = 1; k < middle.x.length; k++) {
    if ((middle.x[k]! - truckX) ** 2 + (middle.z[k]! - truckZ) ** 2 < (middle.x[nearest]! - truckX) ** 2 + (middle.z[nearest]! - truckZ) ** 2) {
      nearest = k;
    }
  }
  const x = Float64Array.from(middle.x.slice(nearest));
  const z = Float64Array.from(middle.z.slice(nearest));
  const along = new Float64Array(x.length);
  for (let k = 1; k < x.length; k++) {
    along[k] = along[k - 1]! + Math.hypot(x[k]! - x[k - 1]!, z[k]! - z[k - 1]!);
  }
  return { count: x.length, x, z, road: new Int32Array(x.length), along };
}

/** Distance from (x, z) to the right-hand lane's line through the whole road. */
function offLane(middle: { x: number[]; z: number[] }, x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let k = 0; k + 1 < middle.x.length; k++) {
    const ax = middle.x[k]!;
    const az = middle.z[k]!;
    const dx = middle.x[k + 1]! - ax;
    const dz = middle.z[k + 1]! - az;
    const length = Math.hypot(dx, dz);
    // The lane: right of the way along it, (−dz, dx).
    const lx = ax + (-dz / length) * LANE;
    const lz = az + (dx / length) * LANE;
    const t = Math.max(0, Math.min(1, ((x - lx) * dx + (z - lz) * dz) / (length * length)));
    best = Math.min(best, Math.hypot(lx + dx * t - x, lz + dz * t - z));
  }
  return best;
}

/**
 * Drives the fixture truck with the pilot from the start of the road in its lane for `seconds`, the route worked
 * out again ten times a second, `limits` given each step (from the truck), `watch` told each step.
 */
function pilot(
  seconds: number,
  limits: (state: VehicleRuntimeState, route: PilotRoute, elapsed: number) => PilotLimits,
  watch: (state: VehicleRuntimeState, elapsed: number) => void = () => {},
) {
  const middle = roadMiddle();
  const dynamics = new VehicleDynamics(truck);
  const state = dynamics.createState(-LANE, 0, 0);
  const autoPilot = new AutoPilot();
  const input = createVehicleInput();
  let route = routeFrom(middle, state.x, state.z);
  const pilotTruck = {
    get x() {
      return state.x;
    },
    get z() {
      return state.z;
    },
    get heading() {
      return state.heading;
    },
    get speed() {
      return state.speed;
    },
    wheelbaseMeters: truck.body.wheelbaseMeters,
    maxSteerAngle: (truck.handling.maxSteerAngleDegrees * Math.PI) / 180,
    steerLateralLimit: truck.handling.maxLateralAccelerationG * 9.81,
  };
  for (let step = 0, elapsed = 0; elapsed < seconds; step++, elapsed += STEP_SECONDS) {
    if (step % 6 === 0) {
      route = routeFrom(middle, state.x, state.z);
    }
    autoPilot.input(route, ROADS, pilotTruck, limits(state, route, elapsed), input);
    expect(input.lever).toBe('drive');
    dynamics.step(state, input, ASPHALT, STEP_SECONDS);
    watch(state, elapsed);
  }
  return { state, middle };
}

const OPEN: Omit<PilotLimits, 'speedLimit'> = { obstacleMeters: Number.POSITIVE_INFINITY, obstacleSpeed: 0, stopAlongMeters: Number.POSITIVE_INFINITY };

describe('AutoPilot', () => {
  it('drives up to the limit in the right-hand lane of a straight road', () => {
    let worst = 0;
    let fastest = 0;
    pilot(
      18,
      () => ({ ...OPEN, speedLimit: 15 }),
      (truckState, elapsed) => {
        if (elapsed > 3) {
          worst = Math.max(worst, offLane(roadMiddle(), truckState.x, truckState.z));
        }
        if (truckState.z > 120 && truckState.z < 190) {
          fastest = Math.max(fastest, truckState.speed);
        }
      },
    );

    expect(fastest).toBeGreaterThan(14);
    expect(fastest).toBeLessThan(15.8);
    expect(worst).toBeLessThan(0.3);
  });

  it('slows for a bend and takes it in its lane, then drives on along the next road', () => {
    let slowest = Number.POSITIVE_INFINITY;
    let worst = 0;
    const middle = roadMiddle();
    // 40 s: along the second road, short of its end.
    const { state } = pilot(
      40,
      () => ({ ...OPEN, speedLimit: 20 }),
      (truckState, elapsed) => {
        if (elapsed > 3) {
          worst = Math.max(worst, offLane(middle, truckState.x, truckState.z));
        }
        if (truckState.z > 290 && truckState.x > -30) {
          slowest = Math.min(slowest, truckState.speed);
        }
      },
    );

    // About √(1.4 m/s² × 30 m) ≈ 6.5 m/s round it, no faster.
    expect(slowest).toBeLessThan(8);
    expect(worst).toBeLessThan(1.4);
    expect(state.x).toBeLessThan(-80); // Along the second road, toward −x.
    expect(Math.abs(state.z - (300 + BEND_RADIUS - LANE))).toBeLessThan(0.6); // Right of −x is −z.
  });

  it('comes to a stop by the hand-over point and holds there without backing up', () => {
    let backwards = false;
    const { state } = pilot(
      40,
      (truckState, route) => ({ ...OPEN, speedLimit: 15, stopAlongMeters: 150 - truckState.z + route.along[0]! }),
      (truckState) => {
        backwards ||= truckState.speed < -0.05;
      },
    );

    expect(state.z).toBeLessThan(150);
    expect(state.z).toBeGreaterThan(130);
    expect(Math.abs(state.speed)).toBeLessThan(0.1);
    expect(backwards).toBe(false);
  });

  it('keeps behind a slower vehicle ahead, and stops short of one standing', () => {
    // A van 70 m ahead at 8 m/s, which stops at z = 200.
    let closest = Number.POSITIVE_INFINITY;
    let leaderZ = 70;
    const { state } = pilot(
      45,
      (truckState) => {
        const leaderSpeed = leaderZ < 200 ? 8 : 0;
        return { ...OPEN, speedLimit: 20, obstacleMeters: leaderZ - truckState.z, obstacleSpeed: leaderSpeed };
      },
      (truckState) => {
        leaderZ = Math.min(200, leaderZ + 8 * STEP_SECONDS);
        closest = Math.min(closest, leaderZ - truckState.z);
      },
    );

    expect(closest).toBeGreaterThan(5);
    expect(state.z).toBeGreaterThan(180);
    expect(Math.abs(state.speed)).toBeLessThan(0.1);
  });
});
