import type { RoadKind } from '../../data/definitions/MapDefinition';
import { laneOffsetMeters } from '../world/lanes';

/**
 * A street race (the owner's car races): from a race club along the road to
 * its finish, against rivals who drive the way as fast as their skill takes
 * the bends. The rivals are planned, not steered: each one's speed along
 * the route is what the bends and its car allow, from a standing start, so
 * where it is at any time after the start is known (RivalPlan). The player's
 * place in the race is how far along the route they have come
 * (RaceProgress).
 */

/** The race's way: the road route's samples from the start to the finish line, each with its distance along it. */
export interface RaceRoute {
  readonly count: number;
  readonly x: Float64Array;
  readonly z: Float64Array;
  /** The road each sample is on, an index into the world's roads. */
  readonly road: Int32Array;
  readonly along: Float64Array;
  /** From the start to the finish line, meters. */
  readonly length: number;
}

/** What a route is copied from (RoadNetwork's RouteTrace). */
export interface RouteSamples {
  readonly count: number;
  readonly x: ArrayLike<number>;
  readonly z: ArrayLike<number>;
  readonly road: ArrayLike<number>;
  readonly along: ArrayLike<number>;
}

/** The race's way, copied out of a trace that will be written again. */
export function raceRouteFrom(trace: RouteSamples): RaceRoute {
  const count = trace.count;
  const x = new Float64Array(count);
  const z = new Float64Array(count);
  const road = new Int32Array(count);
  const along = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    x[k] = trace.x[k]!;
    z[k] = trace.z[k]!;
    road[k] = trace.road[k]!;
    along[k] = trace.along[k]! - trace.along[0]!;
  }
  return { count, x, z, road, along, length: count > 0 ? along[count - 1]! : 0 };
}

/** How a car takes the way: its top speed (m/s), the side pull it corners at and how hard it speeds up and brakes (m/s²). */
export interface RaceDriver {
  readonly topSpeed: number;
  readonly corner: number;
  readonly accelerate: number;
  readonly brake: number;
}

/** Bends are measured over this many samples either side: one sample's kink at a junction is no bend. */
const BEND_SPAN = 3;

/**
 * The fastest a car of `driver`'s can go at each sample from a standing
 * start at sample `from`: no faster than its top speed or than the bend
 * there lets it (corner = v² / radius), and only as fast as it can speed up
 * to and brake down from (0 before `from`).
 */
export function speedProfile(route: RaceRoute, driver: RaceDriver, from = 0): Float64Array {
  const count = route.count;
  const speed = new Float64Array(count);
  for (let k = from; k < count; k++) {
    const bend = bendCurvature(route, k);
    speed[k] = bend > 1e-5 ? Math.min(driver.topSpeed, Math.sqrt(driver.corner / bend)) : driver.topSpeed;
  }
  speed[from] = 0;
  for (let k = from + 1; k < count; k++) {
    const step = route.along[k]! - route.along[k - 1]!;
    speed[k] = Math.min(speed[k]!, Math.sqrt(speed[k - 1]! ** 2 + 2 * driver.accelerate * step));
  }
  for (let k = count - 2; k >= from; k--) {
    const step = route.along[k + 1]! - route.along[k]!;
    speed[k] = Math.min(speed[k]!, Math.sqrt(speed[k + 1]! ** 2 + 2 * driver.brake * step));
  }
  speed[from] = 0;
  return speed;
}

/**
 * How sharply the route bends at sample k, 1/m: the turn between the chords
 * BEND_SPAN samples either side, over the way between their middles (half
 * the way across them).
 */
function bendCurvature(route: RaceRoute, k: number): number {
  const a = Math.max(0, k - BEND_SPAN);
  const b = Math.min(route.count - 1, k + BEND_SPAN);
  if (a === k || b === k) {
    return 0;
  }
  const ax = route.x[k]! - route.x[a]!;
  const az = route.z[k]! - route.z[a]!;
  const bx = route.x[b]! - route.x[k]!;
  const bz = route.z[b]! - route.z[k]!;
  const way = route.along[b]! - route.along[a]!;
  if (way < 1e-6 || (ax === 0 && az === 0) || (bx === 0 && bz === 0)) {
    return 0;
  }
  return Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz)) / (way / 2);
}

/**
 * A rival's race: from `startAlong` (its place on the grid) at the
 * route's best for a driver of its skill (speedProfile), its time at each
 * sample from the start, so where it is at any time. Allocated once, at the
 * race's start.
 */
export class RivalPlan {
  /** Seconds from the start to each sample (from its first one on). */
  private readonly times: Float64Array;
  private readonly first: number;
  readonly finishSeconds: number;

  constructor(
    private readonly route: RaceRoute,
    driver: RaceDriver,
    readonly startAlong: number,
  ) {
    let first = 0;
    while (first + 1 < route.count && route.along[first]! < startAlong) {
      first++;
    }
    this.first = first;
    const speed = speedProfile(route, driver, first);
    this.times = new Float64Array(route.count);
    for (let k = first + 1; k < route.count; k++) {
      const step = route.along[k]! - route.along[k - 1]!;
      // At least a crawl, so a standing start still moves.
      this.times[k] = this.times[k - 1]! + step / Math.max(0.5, (speed[k - 1]! + speed[k]!) / 2);
    }
    this.finishSeconds = this.times[route.count - 1]!;
  }

  /** Meters along the route `seconds` after the start: its grid place before, the finish after it is done. */
  alongAt(seconds: number): number {
    const route = this.route;
    if (seconds <= 0) {
      return route.along[this.first]!;
    }
    if (seconds >= this.finishSeconds) {
      return route.length;
    }
    let low = this.first;
    let high = route.count - 1;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (this.times[middle]! <= seconds) {
        low = middle;
      } else {
        high = middle;
      }
    }
    const span = this.times[high]! - this.times[low]!;
    const t = span > 1e-9 ? (seconds - this.times[low]!) / span : 0;
    return route.along[low]! + (route.along[high]! - route.along[low]!) * t;
  }
}

/** A point on the route: where, which way along it, and the sample before it. */
export interface RoutePoint {
  x: number;
  z: number;
  heading: number;
  index: number;
}

export function createRoutePoint(): RoutePoint {
  return { x: 0, z: 0, heading: 0, index: 0 };
}

/**
 * The point `along` meters along the route in its road's right-hand lane
 * (lane 0, or `lane` from the right), heading along it; written to `out`,
 * the search started at `out.index`. Allocation-free.
 */
export function laneOfRoute(
  route: RaceRoute,
  roads: readonly { readonly kind: RoadKind; readonly widthMeters: number }[],
  along: number,
  lane: number,
  out: RoutePoint,
): RoutePoint {
  let k = Math.min(Math.max(0, out.index), Math.max(0, route.count - 2));
  while (k > 0 && route.along[k]! > along) {
    k--;
  }
  while (k + 2 < route.count && route.along[k + 1]! < along) {
    k++;
  }
  const dx = route.x[k + 1]! - route.x[k]!;
  const dz = route.z[k + 1]! - route.z[k]!;
  const span = route.along[k + 1]! - route.along[k]!;
  const t = span > 1e-9 ? Math.min(1, Math.max(0, (along - route.along[k]!) / span)) : 0;
  const length = Math.sqrt(dx * dx + dz * dz) || 1;
  const road = roads[route.road[k]!];
  const lanes = road === undefined ? 0 : laneOffsetMeters(road.kind, road.widthMeters, Math.min(lane, road.kind === 'highway' ? 1 : 0));
  // Right of the way along it, (dx, dz), is (−dz, dx).
  out.x = route.x[k]! + dx * t + (-dz / length) * lanes;
  out.z = route.z[k]! + dz * t + (dx / length) * lanes;
  out.heading = Math.atan2(dx, dz);
  out.index = k;
  return out;
}

/**
 * Where the player has got to: the point of the route nearest the car, near
 * where it was last (so a road crossing the route elsewhere does not count),
 * its distance along the route, and how far the car is off it.
 */
export class RaceProgress {
  private index = 0;
  alongMeters = 0;
  offRouteMeters = 0;

  constructor(private readonly route: RaceRoute) {}

  /** The car at (x, z): its place along the route. Allocation-free. */
  update(x: number, z: number): void {
    const route = this.route;
    let best = Number.POSITIVE_INFINITY;
    let bestAlong = this.alongMeters;
    let bestIndex = this.index;
    const from = Math.max(0, this.index - 20);
    const to = Math.min(route.count - 1, this.index + 60);
    for (let k = from; k < to; k++) {
      const ax = route.x[k]!;
      const az = route.z[k]!;
      const dx = route.x[k + 1]! - ax;
      const dz = route.z[k + 1]! - az;
      const lengthSquared = dx * dx + dz * dz;
      const t = lengthSquared > 1e-9 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / lengthSquared)) : 0;
      const ex = ax + dx * t - x;
      const ez = az + dz * t - z;
      const distance = ex * ex + ez * ez;
      if (distance < best) {
        best = distance;
        bestIndex = k;
        bestAlong = route.along[k]! + (route.along[k + 1]! - route.along[k]!) * t;
      }
    }
    this.index = bestIndex;
    this.alongMeters = bestAlong;
    this.offRouteMeters = Math.sqrt(best);
  }
}

/** The player's place among the field: 1 for the lead, counting each rival further along the route. */
export function racePosition(playerAlong: number, rivalsAlong: ArrayLike<number>): number {
  let ahead = 0;
  for (let i = 0; i < rivalsAlong.length; i++) {
    if (rivalsAlong[i]! > playerAlong) {
      ahead++;
    }
  }
  return 1 + ahead;
}
