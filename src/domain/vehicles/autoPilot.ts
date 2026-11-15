import type { RoadKind } from '../../data/definitions/MapDefinition';
import { laneOffsetMeters } from '../world/lanes';
import type { VehicleInput } from './VehicleInput';

/** What the pilot follows: a route's samples on the roads' middles, the first near the truck (RoadNetwork's RouteTrace). */
export interface PilotRoute {
  readonly count: number;
  readonly x: Float64Array;
  readonly z: Float64Array;
  /** The road each sample is on, an index into the roads given. */
  readonly road: Int32Array;
  /** Meters along the route from its first sample. */
  readonly along: Float64Array;
}

/** A road the route runs on: its kind and width set where its right-hand lane lies (lanes.ts). */
export interface PilotRoad {
  readonly kind: RoadKind;
  readonly widthMeters: number;
}

/** The truck as the pilot drives it. */
export interface PilotTruck {
  /** The rear axle, meters, its heading (0 along +z, π/2 along +x) and its speed, m/s. */
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly speed: number;
  readonly wheelbaseMeters: number;
  /** The steering's full lock, radians, and the side pull its whole travel asks for at speed, m/s² (VehicleDynamics). */
  readonly maxSteerAngle: number;
  readonly steerLateralLimit: number;
}

/** What the pilot keeps to and stops for. */
export interface PilotLimits {
  /** The fastest it may go here, m/s: the road's limit, or the truck's own top speed. */
  readonly speedLimit: number;
  /** Something ahead to keep behind (a vehicle, a red light's line), meters to it, and its speed, m/s; Infinity for nothing. */
  readonly obstacleMeters: number;
  readonly obstacleSpeed: number;
  /** Meters along the route by which the truck must stand still (the hand-over short of the yard). */
  readonly stopAlongMeters: number;
}

/** It aims at a point this far ahead on the route: at least, this much more per m/s, at most (meters). */
const LOOK_AHEAD_MIN_METERS = 7;
const LOOK_AHEAD_PER_SPEED = 0.9;
const LOOK_AHEAD_MAX_METERS = 30;
/** It takes bends at no more than this side pull, m/s², and slows down at this, m/s². */
export const PILOT_CORNER_ACCELERATION = 1.4;
export const PILOT_DECELERATION = 1.8;
/** It keeps this many seconds behind what drives ahead, and stops this far short of it, meters. */
const FOLLOW_SECONDS = 2;
const STANDSTILL_GAP_METERS = 6;
/** It plans to stand still this far short of the hand-over point, meters: braking lags its plan a little. */
const STOP_MARGIN_METERS = 3;
/** The dynamics' steering spans a little more than the side pull asked for (VehicleDynamics' STEER_RANGE_MARGIN). */
const STEER_RANGE_MARGIN = 1.15;
/** The bends are looked for this far ahead at least, more at speed (its braking distance and this). */
const BEND_SCAN_MIN_METERS = 40;
/** The pedals: gas this hard per m/s short of the speed wanted (with a little held to keep it rolling), brakes per m/s over. */
const GAS_PER_SPEED = 0.3;
const GAS_HOLD = 0.12;
const BRAKE_PER_SPEED = 0.22;
/** Over the speed wanted by less than this, m/s, it just rolls; standing, it holds the brake. */
const COAST_BAND = 0.8;
const HOLD_BRAKE = 0.5;

/**
 * Auto-drive's driver: the pedals and the wheel for following a route in
 * the right-hand lane of its roads (pure pursuit: an arc through a point
 * ahead on the lane, nearer when slow), at the most the limits let it: the
 * road's limit, the bends ahead (no more than PILOT_CORNER_ACCELERATION
 * round them, braking at PILOT_DECELERATION before them), a vehicle or a
 * red light ahead (two seconds behind a vehicle, stopping short of it), and
 * standing still by `stopAlongMeters`. The lever stays in drive, so a held
 * brake never backs the truck up. Allocation-free after it is made.
 */
export class AutoPilot {
  /** The point aimed at this step. */
  private readonly aim = { x: 0, z: 0 };

  /** Writes `input` for the next step along `route`; returns the speed it wants, m/s. */
  input(route: PilotRoute, roads: readonly PilotRoad[], truck: PilotTruck, limits: PilotLimits, input: VehicleInput): number {
    return pilotInput(route, roads, truck, limits, input, this.aim);
  }
}

function pilotInput(
  route: PilotRoute,
  roads: readonly PilotRoad[],
  truck: PilotTruck,
  limits: PilotLimits,
  input: VehicleInput,
  aimOut: { x: number; z: number },
): number {
  input.lever = 'drive';
  if (route.count < 2) {
    input.steer = 0;
    input.throttle = 0;
    input.brake = HOLD_BRAKE;
    return 0;
  }
  const speed = Math.max(0, truck.speed);
  const forwardX = Math.sin(truck.heading);
  const forwardZ = Math.cos(truck.heading);
  // Where the truck is along the route: the nearest of the samples near its start.
  let nearest = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let k = 0; k < route.count && k < 16; k++) {
    const dx = route.x[k]! - truck.x;
    const dz = route.z[k]! - truck.z;
    const distance = dx * dx + dz * dz;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = k;
    }
  }
  const here = route.along[nearest]!;

  // The wheel: an arc through the lane's point ahead.
  const lookAhead = Math.min(LOOK_AHEAD_MAX_METERS, LOOK_AHEAD_MIN_METERS + speed * LOOK_AHEAD_PER_SPEED);
  const aim = laneAimAt(route, roads, nearest, here + lookAhead, aimOut);
  const dx = aim.x - truck.x;
  const dz = aim.z - truck.z;
  const sideways = dx * -forwardZ + dz * forwardX; // To the right of the truck: positive.
  const distanceSquared = dx * dx + dz * dz;
  const curvature = distanceSquared > 1e-6 ? (2 * sideways) / distanceSquared : 0;
  const angle = Math.atan(curvature * truck.wheelbaseMeters);
  const range =
    speed > 0.5
      ? Math.min(truck.maxSteerAngle, Math.atan((truck.steerLateralLimit * truck.wheelbaseMeters) / (speed * speed)) * STEER_RANGE_MARGIN)
      : truck.maxSteerAngle;
  input.steer = clamp(angle / range, -1, 1);

  // The speed: the limit, the bends ahead, what is ahead, and the stop.
  let wanted = limits.speedLimit;
  const scan = BEND_SCAN_MIN_METERS + (speed * speed) / (2 * PILOT_DECELERATION);
  for (let k = nearest + 1; k + 1 < route.count; k++) {
    const ahead = route.along[k]! - here;
    if (ahead > scan) {
      break;
    }
    const bend = bendCurvature(route, k);
    if (bend > 1e-4) {
      const there = Math.sqrt(PILOT_CORNER_ACCELERATION / bend);
      wanted = Math.min(wanted, Math.sqrt(there * there + 2 * PILOT_DECELERATION * Math.max(0, ahead)));
    }
  }
  if (Number.isFinite(limits.obstacleMeters)) {
    const room = limits.obstacleMeters - STANDSTILL_GAP_METERS;
    const leader = Math.max(0, limits.obstacleSpeed);
    // Close enough to brake for it to a stop short of it, and no closer than two seconds at its pace.
    wanted = Math.min(
      wanted,
      Math.sqrt(leader * leader + 2 * PILOT_DECELERATION * Math.max(0, room)),
      Math.max(0, room) / FOLLOW_SECONDS + leader * 0.5,
    );
  }
  wanted = Math.min(wanted, Math.sqrt(2 * PILOT_DECELERATION * Math.max(0, limits.stopAlongMeters - STOP_MARGIN_METERS - here)));
  wanted = Math.max(0, wanted);

  // The pedals.
  const short = wanted - speed;
  if (wanted < 0.3 && speed < 0.5) {
    input.throttle = 0;
    input.brake = HOLD_BRAKE;
  } else if (short > 0) {
    input.throttle = clamp(GAS_HOLD + short * GAS_PER_SPEED, 0, 1);
    input.brake = 0;
  } else if (-short < COAST_BAND) {
    input.throttle = 0;
    input.brake = 0;
  } else {
    input.throttle = 0;
    input.brake = clamp(-short * BRAKE_PER_SPEED, 0, 1);
  }
  return wanted;
}

/** The point `along` meters along the route, moved right of its road's middle to its right-hand lane; written to `out`. */
function laneAimAt(
  route: PilotRoute,
  roads: readonly PilotRoad[],
  from: number,
  along: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  let k = from;
  while (k + 2 < route.count && route.along[k + 1]! < along) {
    k++;
  }
  const ax = route.x[k]!;
  const az = route.z[k]!;
  const bx = route.x[k + 1]!;
  const bz = route.z[k + 1]!;
  const span = route.along[k + 1]! - route.along[k]!;
  const t = span > 1e-9 ? clamp((along - route.along[k]!) / span, 0, 1) : 1;
  const dx = bx - ax;
  const dz = bz - az;
  const length = Math.sqrt(dx * dx + dz * dz) || 1;
  const road = roads[route.road[k]!];
  const offset = road === undefined ? 0 : laneOffsetMeters(road.kind, road.widthMeters, 0);
  // Right of the way along it (dx, dz) is (−dz, dx).
  out.x = ax + dx * t + (-dz / length) * offset;
  out.z = az + dz * t + (dx / length) * offset;
  return out;
}

/** How sharply the route bends at sample k: the turn between the segments either side over their length, 1/m. */
function bendCurvature(route: PilotRoute, k: number): number {
  const ax = route.x[k]! - route.x[k - 1]!;
  const az = route.z[k]! - route.z[k - 1]!;
  const bx = route.x[k + 1]! - route.x[k]!;
  const bz = route.z[k + 1]! - route.z[k]!;
  const a = Math.sqrt(ax * ax + az * az);
  const b = Math.sqrt(bx * bx + bz * bz);
  if (a < 1e-6 || b < 1e-6) {
    return 0;
  }
  const turn = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
  return turn / ((a + b) / 2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
