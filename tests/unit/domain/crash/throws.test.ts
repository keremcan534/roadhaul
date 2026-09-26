import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../../../../src/core/random/SeededRandom';
import { KNOCKABLES, knockableCode } from '../../../../src/domain/crash/knockables';
import { knockThrow, truckSpeedLoss, wreckThrow } from '../../../../src/domain/crash/throws';
import { WRECK_DEBRIS_KIND, WRECKABLES } from '../../../../src/domain/crash/wrecks';
import { trafficVehicleFixture } from '../../../support/contentFixtures';

/** A 20 t truck heading north (+z) at 15 m/s. */
const TRUCK = { massKg: 20000, vx: 0, vz: 15 } as const;

describe('knockThrow', () => {
  it('sends a thing struck head-on flying the way the truck drove, up and off where it stood', () => {
    // Struck from the south: the normal points from the bin back to the truck.
    const bin = knockThrow('bin', 42, { x: 10, z: 20, heading: 0 }, TRUCK, 15, 0, -1, 1, new SeededRandom(1));
    expect([bin.kind, bin.ref, bin.shape]).toEqual([knockableCode('bin'), 42, KNOCKABLES.bin.shape]);
    expect([bin.x, bin.y, bin.z]).toEqual([10, KNOCKABLES.bin.shape.halfY, 20]);
    expect(bin.vz).toBeCloseTo(15 * KNOCKABLES.bin.throwShare, 9);
    expect(bin.vx).toBeCloseTo(0, 9);
    expect(bin.vy).toBeCloseTo(bin.vz * KNOCKABLES.bin.popShare, 9);
    // The throw factor makes it fly harder.
    const harder = knockThrow('bin', 42, { x: 10, z: 20, heading: 0 }, TRUCK, 15, 0, -1, 2, new SeededRandom(1));
    expect(harder.vz).toBeCloseTo(2 * bin.vz, 9);
  });

  it('topples a lamp post away from the truck, from its middle beside its foot', () => {
    // Its arm reaches east over the road; struck from the south.
    const lamp = knockThrow('lamp', 3, { x: 0, z: 0, heading: Math.PI / 2 }, TRUCK, 10, 0, -1, 1, new SeededRandom(1));
    expect(lamp.x).toBeCloseTo(KNOCKABLES.lamp.centreZ, 9);
    expect(lamp.z).toBeCloseTo(0, 9);
    expect(lamp.heading).toBe(Math.PI / 2);
    // Spinning about +x: its top goes north, the way it flies (the tumble is too small to turn that round).
    expect(lamp.spinX).toBeGreaterThan(0.5 * KNOCKABLES.lamp.topple * 10);
  });

  it('drags a thing struck a glancing blow along with the truck', () => {
    // Struck on its west side by the truck passing north: the normal points west.
    const bench = knockThrow('bench', 1, { x: 0, z: 0 }, TRUCK, 3, -1, 0, 1, new SeededRandom(1));
    expect(bench.vx).toBeCloseTo(3 * KNOCKABLES.bench.throwShare, 9);
    expect(bench.vz).toBeCloseTo(15 * 0.4, 9);
  });
});

describe('wreckThrow', () => {
  const car = trafficVehicleFixture({ lengthMeters: 4.4, widthMeters: 1.8, heightMeters: 1.5 });
  const wreckable = WRECKABLES.car!;

  it('throws a wrecked car off with its own speed and the knock, as a box its size', () => {
    // The car heading north at 10 m/s, struck on its west side by the truck driving east at 15 m/s.
    const truck = { massKg: 20000, vx: 15, vz: 0 };
    const wreck = wreckThrow(car, 3, wreckable, { x: 5, z: 6, heading: 0, speed: 10 }, truck, 15, -1, 0, 1, new SeededRandom(1));
    expect([wreck.kind, wreck.ref]).toEqual([WRECK_DEBRIS_KIND, 3]);
    expect([wreck.shape.halfX, wreck.shape.halfY, wreck.shape.halfZ, wreck.shape.massKg]).toEqual([0.9, 0.75, 2.2, 1250]);
    expect([wreck.x, wreck.y, wreck.z]).toEqual([5, 0.75, 6]);
    const knock = ((1.3 * 20000) / 21250) * 15;
    expect(wreck.vx).toBeCloseTo(knock, 9);
    expect(wreck.vz).toBeCloseTo(10, 9);
    expect(wreck.vy).toBeGreaterThan(0);
    // It rolls away from the truck: about -z, its top going east.
    expect(wreck.spinZ).toBeLessThan(0);
  });
});

describe('truckSpeedLoss', () => {
  it('is the momentum the thing takes: next to nothing for a bin, more for a car', () => {
    expect(truckSpeedLoss(20000, 15, 15)).toBeLessThan(0.02);
    expect(truckSpeedLoss(20000, 1250, 15)).toBeCloseTo((1.3 * 1250 * 15) / 21250, 9);
    expect(truckSpeedLoss(20000, 1250, -3)).toBe(0);
  });
});
