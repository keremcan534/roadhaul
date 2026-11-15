import { describe, expect, it } from 'vitest';
import {
  createRoutePoint,
  laneOfRoute,
  RaceProgress,
  racePosition,
  raceRouteFrom,
  RivalPlan,
  speedProfile,
  type RaceDriver,
} from '../../../../src/domain/race/streetRace';

/** 400 m along +z, a right-hand bend of 30 m radius, then 400 m along −x: a sample every 2 m (the trace starts 10 m in). */
function route() {
  const x: number[] = [];
  const z: number[] = [];
  for (let s = 0; s <= 400; s += 2) {
    x.push(0);
    z.push(s);
  }
  for (let a = 0.05; a < Math.PI / 2; a += 0.05) {
    x.push(-30 + 30 * Math.cos(a));
    z.push(400 + 30 * Math.sin(a));
  }
  for (let s = 0; s <= 400; s += 2) {
    x.push(-30 - s);
    z.push(430);
  }
  const along = [10];
  for (let k = 1; k < x.length; k++) {
    along.push(along[k - 1]! + Math.hypot(x[k]! - x[k - 1]!, z[k]! - z[k - 1]!));
  }
  return raceRouteFrom({ count: x.length, x, z, road: x.map(() => 0), along });
}

const DRIVER: RaceDriver = { topSpeed: 40, corner: 7, accelerate: 3, brake: 6 };

describe('street race', () => {
  it('copies the route, measured from its start', () => {
    const way = route();

    expect(way.along[0]).toBe(0);
    expect(way.length).toBeCloseTo(400 + (Math.PI / 2) * 30 + 400, -1);
  });

  it('plans a car\'s speed from a standing start: speeding up, its top speed, and slow enough for the bend', () => {
    const way = route();
    const speed = speedProfile(way, DRIVER);
    const at = (z: number) => speed[way.z.findIndex((value, k) => way.x[k] === 0 && value >= z)]!;

    expect(speed[0]).toBe(0);
    // √(2 × 3 m/s² × 48 m) = 17 m/s after 48 m.
    expect(at(48)).toBeCloseTo(17, 0);
    expect(Math.max(...speed)).toBeLessThanOrEqual(DRIVER.topSpeed);
    // In the bend, no more than √(7 × 30) ≈ 14.5 m/s, and slowing before it.
    const inBend = Array.from(speed).filter((_, k) => way.z[k]! > 405 && way.x[k]! > -25 && way.x[k]! < -5);
    expect(Math.max(...inBend)).toBeLessThan(15.5);
    expect(at(380)).toBeLessThan(DRIVER.topSpeed);
  });

  it('knows where a rival is at any time after the start, a quicker one finishing first', () => {
    const way = route();
    const steady = new RivalPlan(way, DRIVER, 12);
    const quick = new RivalPlan(way, { ...DRIVER, topSpeed: 45, corner: 8 }, 12);

    expect(steady.alongAt(-1)).toBeCloseTo(12, 0);
    expect(steady.alongAt(10)).toBeGreaterThan(steady.alongAt(5));
    expect(steady.alongAt(steady.finishSeconds + 5)).toBe(way.length);
    expect(quick.finishSeconds).toBeLessThan(steady.finishSeconds);
    // About 860 m at up to 40 m/s, from a standing start, with a bend: half a minute or so.
    expect(steady.finishSeconds).toBeGreaterThan(25);
    expect(steady.finishSeconds).toBeLessThan(45);
  });

  it('puts a car in the right-hand lane of the route\'s road, facing along it', () => {
    const way = route();
    const point = laneOfRoute(way, [{ kind: 'rural', widthMeters: 7 }], 100, 0, createRoutePoint());

    expect(point.x).toBeCloseTo(-1.75, 6);
    expect(point.z).toBeCloseTo(100, 6);
    expect(point.heading).toBeCloseTo(0, 6);
    // Along −x after the bend, its right is −z.
    laneOfRoute(way, [{ kind: 'rural', widthMeters: 7 }], way.length - 50, 0, point);
    expect(point.z).toBeCloseTo(430 - 1.75, 6);
    expect(point.heading).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('follows the player along the route, and how far off it they are', () => {
    const way = route();
    const progress = new RaceProgress(way);
    for (let z = 0; z <= 100; z += 5) {
      progress.update(-1.75, z);
    }

    expect(progress.alongMeters).toBeCloseTo(100, 0);
    expect(progress.offRouteMeters).toBeCloseTo(1.75, 1);
    progress.update(-60, 104);
    expect(progress.offRouteMeters).toBeGreaterThan(50);
  });

  it('places the player among the field by how far along each one is', () => {
    expect(racePosition(500, [400, 450, 300])).toBe(1);
    expect(racePosition(500, [400, 650, 600])).toBe(3);
    expect(racePosition(100, [400, 650, 600])).toBe(4);
  });
});
