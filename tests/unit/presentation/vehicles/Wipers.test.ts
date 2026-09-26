import { Color, Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  bladeAngle,
  secondsSinceWiped,
  SWEEP_RADIANS,
  SWEEP_SECONDS,
  wiperPause,
  Wipers,
} from '../../../../src/presentation/vehicles/Wipers';
import { gpuResources, watchDisposal } from '../../../support/threeResources';

const STEP = 1 / 60;
const PLACE = { width: 2.25, bottom: 1.82, top: 2.67, z: 5.76 } as const;

function setup(): Wipers {
  return new Wipers(PLACE, { value: new Color(0xc4dcef) });
}

/** Runs `seconds` of `rain`: how many sweeps went up past half-way, and the highest the blades went. */
function run(wipers: Wipers, seconds: number, rain: number): { sweeps: number; highest: number } {
  let sweeps = 0;
  let highest = 0;
  let previous = wipers.angle;
  for (let step = 0; step < Math.round(seconds / STEP); step++) {
    wipers.update(STEP, rain);
    if (previous < SWEEP_RADIANS / 2 && wipers.angle >= SWEEP_RADIANS / 2) sweeps++;
    previous = wipers.angle;
    highest = Math.max(highest, wipers.angle);
  }
  return { sweeps, highest };
}

/** The way the blade of wiper `index` points from its pivot, in the truck's frame. */
function bladeDirection(wipers: Wipers, index: number): Vector3 {
  const matrix = new Matrix4();
  wipers.blades.getMatrixAt(index, matrix);
  const turn = new Quaternion();
  matrix.decompose(new Vector3(), turn, new Vector3());
  return new Vector3(-1, 0, 0).applyQuaternion(turn);
}

describe('Wipers', () => {
  it('stay parked along the foot of the glass while it is dry', () => {
    const wipers = setup();

    expect(run(wipers, 10, 0)).toEqual({ sweeps: 0, highest: 0 });
    expect(bladeDirection(wipers, 0).x).toBeCloseTo(-1, 9);
    expect(wipers.glass.material).toBeDefined();
  });

  it('sweep on without a pause in heavy rain, and wait between sweeps in light rain', () => {
    const heavy = run(setup(), 20, 1);
    const light = run(setup(), 20, 0.15);

    expect(heavy.sweeps).toBeGreaterThanOrEqual(Math.floor(20 / SWEEP_SECONDS) - 1);
    expect(heavy.highest).toBeCloseTo(SWEEP_RADIANS, 2);
    expect(light.sweeps).toBeGreaterThanOrEqual(2);
    expect(light.sweeps).toBeLessThanOrEqual(5);
    expect(wiperPause(1)).toBe(0);
    expect(wiperPause(0.15)).toBeGreaterThan(3);
  });

  it('finish a sweep under way when the rain stops, then park', () => {
    const wipers = setup();
    while (wipers.angle < 0.5) {
      wipers.update(STEP, 1);
    }

    const after = run(wipers, 3, 0);

    expect(after.highest).toBeCloseTo(SWEEP_RADIANS, 2);
    expect(wipers.angle).toBe(0);
    expect(wipers.sweeping).toBe(false);
  });

  it('sweep up from the foot of the glass, over the top of the sweep toward the driver\'s side', () => {
    const wipers = setup();
    let top = 0;
    let direction = new Vector3();
    for (let step = 0; step < Math.round(SWEEP_SECONDS / STEP); step++) {
      wipers.update(STEP, 1);
      if (wipers.angle > top) {
        top = wipers.angle;
        direction = bladeDirection(wipers, 0);
      }
    }

    // Parked they point right (−x); at the top of the sweep, up and a little past upright to the left (+x).
    expect(direction.y).toBeGreaterThan(0.9);
    expect(direction.x).toBeGreaterThan(0.15);
    expect(direction.z).toBeCloseTo(0, 9);
  });

  it('know how long ago the blade passed each spot of the glass, on its way up or back', () => {
    const fraction = 0.3;
    const gap = 3;
    /** The last moment at or before `phase` (seconds into this sweep, the last one `gap` before) the blade stood at `fraction`. */
    const lastPass = (phase: number): number => {
      const at = fraction * SWEEP_RADIANS;
      for (let t = phase; t > -gap; t -= 0.0005) {
        const now = t >= 0 ? bladeAngle(t) : bladeAngle(t + gap);
        const before = t - 0.0005 >= 0 ? bladeAngle(t - 0.0005) : bladeAngle(t - 0.0005 + gap);
        if ((now - at) * (before - at) <= 0) {
          return phase - t;
        }
      }
      return Infinity;
    };

    for (const phase of [0.1, 0.4, 0.8, 1.2, 2]) {
      expect(secondsSinceWiped(fraction, phase, gap), `phase ${phase}`).toBeCloseTo(lastPass(phase), 2);
    }
    expect(bladeAngle(-1)).toBe(0);
    expect(bladeAngle(SWEEP_SECONDS / 2)).toBeCloseTo(SWEEP_RADIANS, 12);
  });

  it('releases every GPU resource on dispose', () => {
    const wipers = setup();
    const resources = new Set([...gpuResources(wipers.blades), ...gpuResources(wipers.glass)]);
    const disposed = watchDisposal(resources);

    wipers.dispose();

    expect([...resources].filter((resource) => !disposed.has(resource))).toEqual([]);
  });
});
