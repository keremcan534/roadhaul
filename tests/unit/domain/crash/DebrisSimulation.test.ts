import { describe, expect, it } from 'vitest';
import {
  DebrisSimulation,
  type DebrisLaunch,
  type DebrisShape,
  type DebrisSolids,
} from '../../../../src/domain/crash/DebrisSimulation';

const DT = 1 / 60;
const CRATE: DebrisShape = { halfX: 0.5, halfY: 0.5, halfZ: 0.5, massKg: 40, restitution: 0.3, friction: 0.6 };
const PLANK: DebrisShape = { halfX: 0.2, halfY: 0.4, halfZ: 1.2, massKg: 30, restitution: 0.25, friction: 0.6 };

function launch(overrides: Partial<DebrisLaunch> = {}): DebrisLaunch {
  return { kind: 1, ref: 7, shape: CRATE, x: 0, y: 2, z: 0, heading: 0, vx: 0, vy: 0, vz: 0, spinX: 0, spinY: 0, spinZ: 0, ...overrides };
}

function run(sim: DebrisSimulation, seconds: number): void {
  for (let t = 0; t < seconds; t += DT) {
    sim.step(DT);
  }
}

/** A wall along x = 5, solid to the west of it: bodies coming from the west bounce back off it. */
const WALL: DebrisSolids = {
  collideDebris(x, _z, radius, _vx, _vz, out) {
    const depth = x + radius - 5;
    if (depth <= 0) {
      return false;
    }
    out.normalX = -1;
    out.normalZ = 0;
    out.depth = depth;
    return true;
  },
};

/** Body `slot`'s heading: the way its own +z points on the ground (radians, 0 along +z). */
function headingOf(sim: DebrisSimulation, slot: number): number {
  const [x, y, z, w] = [sim.qx[slot]!, sim.qy[slot]!, sim.qz[slot]!, sim.qw[slot]!];
  // The third column of the rotation matrix: where the local +z points.
  return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
}

/** How body `slot`'s own axes stand: the world y of each, turned by its quaternion. */
function upOfAxes(sim: DebrisSimulation, slot: number): [number, number, number] {
  const [x, y, z, w] = [sim.qx[slot]!, sim.qy[slot]!, sim.qz[slot]!, sim.qw[slot]!];
  // The second row of the rotation matrix: how far up each local axis points.
  return [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)];
}

describe('DebrisSimulation', () => {
  it('drops a box, which bounces, settles on the ground upright and sleeps', () => {
    const sim = new DebrisSimulation(4);
    const slot = sim.launch(launch());
    run(sim, 0.3);
    expect(sim.y[slot]).toBeLessThan(2);
    run(sim, 4);
    expect(sim.resting[slot]).toBe(1);
    expect(sim.y[slot]).toBeCloseTo(0.5, 1);
    expect(upOfAxes(sim, slot)[1]).toBeGreaterThan(0.99);
    expect([sim.kind[slot], sim.ref[slot]]).toEqual([1, 7]);
  });

  it('slides and tumbles a thrown box to rest a sensible way off', () => {
    const sim = new DebrisSimulation(4);
    const slot = sim.launch(launch({ vx: 12, vy: 3 }));
    run(sim, 8);
    expect(sim.resting[slot]).toBe(1);
    expect(sim.x[slot]).toBeGreaterThan(4);
    expect(sim.x[slot]).toBeLessThan(40);
    expect(Math.abs(sim.z[slot]!)).toBeLessThan(1e-6);
    expect(sim.y[slot]!).toBeGreaterThan(0.45);
    expect(sim.y[slot]!).toBeLessThan(0.55);
  });

  it('comes to rest on one of its faces after tumbling end over end', () => {
    const sim = new DebrisSimulation(4);
    const slot = sim.launch(launch({ shape: PLANK, vz: 9, vy: 4, spinX: 9, spinY: 2 }));
    run(sim, 1);
    // Tumbling: no longer the way it was launched.
    expect(upOfAxes(sim, slot)[1]).toBeLessThan(0.99);
    run(sim, 10);
    expect(sim.resting[slot]).toBe(1);
    const up = upOfAxes(sim, slot).map(Math.abs);
    expect(Math.max(...up)).toBeGreaterThan(0.97);
    // Lying on the face whose axis stands up: its middle as high as that half extent.
    const standing = up.indexOf(Math.max(...up));
    const half = [PLANK.halfX, PLANK.halfY, PLANK.halfZ][standing]!;
    expect(sim.y[slot]).toBeCloseTo(half, 1);
  });

  it('does the same every time from the same launch', () => {
    const play = (): number[] => {
      const sim = new DebrisSimulation(2);
      sim.launch(launch({ vx: 7, vz: -3, vy: 5, spinX: 4, spinZ: -6 }));
      run(sim, 3);
      return [sim.x[0]!, sim.y[0]!, sim.z[0]!, sim.qx[0]!, sim.qy[0]!, sim.qz[0]!, sim.qw[0]!];
    };
    expect(play()).toEqual(play());
  });

  it('sinks what lands in the water, and forgets it', () => {
    const sim = new DebrisSimulation(4, (x) => x < 5);
    const slot = sim.launch(launch({ x: 10 }));
    run(sim, 3);
    expect(sim.active[slot]).toBe(0);
    expect(sim.count).toBe(0);
  });

  it('makes room for a new body by the oldest, a resting one first', () => {
    const sim = new DebrisSimulation(2);
    const first = sim.launch(launch({ y: 0.5 }));
    run(sim, 2);
    const second = sim.launch(launch({ x: 5, y: 3, vy: 10 }));
    expect(sim.resting[first]).toBe(1);
    const third = sim.launch(launch({ x: 9, ref: 3 }));
    expect(sim.count).toBe(2);
    // The resting one gave up its slot, though the flying one is younger.
    expect(third).toBe(first);
    expect(sim.ref[third]).toBe(3);
    expect(sim.active[second]).toBe(1);
  });

  it('is shoved out of the way, and woken, by something driving into it', () => {
    const sim = new DebrisSimulation(2);
    const slot = sim.launch(launch({ y: 0.5 }));
    run(sim, 2);
    expect(sim.resting[slot]).toBe(1);
    // Something 1 m across coming from the west at 6 m/s, overlapping it.
    sim.shove(-1, 0, 1, 6, 0);
    expect(sim.resting[slot]).toBe(0);
    expect(sim.x[slot]).toBeGreaterThan(0);
    run(sim, 0.5);
    expect(sim.x[slot]).toBeGreaterThan(1);
  });

  it('bounces off something solid, and back the way it came', () => {
    const sim = new DebrisSimulation(2, undefined, WALL);
    const slot = sim.launch(launch({ vx: 10, vy: 2 }));
    run(sim, 0.5);
    expect(sim.x[slot]).toBeLessThan(5);
    run(sim, 3);
    expect(sim.x[slot]!).toBeLessThan(4.5);
    expect(sim.x[slot]!).toBeGreaterThan(-10);
  });

  it('spins off something solid it strikes with its end', () => {
    const sim = new DebrisSimulation(2, undefined, WALL);
    // A plank, long along its own z, turned 40° off the wall's normal, flying east into the wall (still in the air).
    const slot = sim.launch(launch({ shape: PLANK, heading: 0.7, vx: 12, y: 3 }));
    run(sim, 0.5);
    expect(Math.abs(headingOf(sim, slot) - 0.7)).toBeGreaterThan(0.05);
    // Without the wall it would still fly as it was launched.
    const free = new DebrisSimulation(2);
    const plank = free.launch(launch({ shape: PLANK, heading: 0.7, vx: 12, y: 3 }));
    run(free, 0.5);
    expect(headingOf(free, plank)).toBeCloseTo(0.7, 9);
  });

  it('flies over what is lower than it', () => {
    const sim = new DebrisSimulation(2, undefined, WALL);
    const slot = sim.launch(launch({ vx: 12, y: 12, vy: 3 }));
    run(sim, 0.7);
    expect(sim.x[slot]).toBeGreaterThan(6);
  });

  it("keeps each body's pose before the last step, for drawing between steps", () => {
    const sim = new DebrisSimulation(2);
    const slot = sim.launch(launch({ vx: 6, spinY: 2 }));
    expect([sim.previousX[slot], sim.previousY[slot], sim.previousQw[slot]]).toEqual([0, 2, 1]);
    const [x, y, qy] = [sim.x[slot]!, sim.y[slot]!, sim.qy[slot]!];
    sim.step(DT);
    expect([sim.previousX[slot], sim.previousY[slot], sim.previousQy[slot]]).toEqual([x, y, qy]);
    expect(sim.x[slot]).toBeGreaterThan(x);
  });
});
