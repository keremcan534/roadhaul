import { describe, expect, it } from 'vitest';
import {
  CONVOY_FOLLOW_GAPS,
  CONVOY_LOST_METERS,
  CONVOY_TOP_SPEEDS,
  ConvoyTrail,
} from '../../../../src/domain/missions/convoyTrail';

const STEP = 1 / 60;

/** The truck's rear axle, driven by hand: `speed` m/s (negative backs up), turning at `turnRate` rad/s. */
interface Truck {
  x: number;
  z: number;
  heading: number;
}

/** Drives `truck` for `seconds`, stepping `trail` at 60 Hz; returns the followers lost, in order. */
function drive(trail: ConvoyTrail, truck: Truck, speed: number, seconds: number, turnRate = 0): number[] {
  const lost: number[] = [];
  for (let t = 0; t < seconds - 1e-9; t += STEP) {
    truck.heading += turnRate * STEP;
    truck.x += Math.sin(truck.heading) * speed * STEP;
    truck.z += Math.cos(truck.heading) * speed * STEP;
    const index = trail.step(STEP, truck.x, truck.z, truck.heading);
    if (index >= 0) {
      lost.push(index);
    }
  }
  return lost;
}

/** How far follower `i` is from the truck's rear axle, meters. */
const behind = (trail: ConvoyTrail, truck: Truck, i: number) =>
  Math.sqrt((trail.vehicleX[i]! - truck.x) ** 2 + (trail.vehicleZ[i]! - truck.z) ** 2);

describe('ConvoyTrail', () => {
  it('pulls each truck out behind the truck once it is its gap ahead, and keeps it there', () => {
    const truck = { x: 10, z: 20, heading: 0 };
    const trail = new ConvoyTrail(truck.x, truck.z);
    expect(Array.from(trail.shown)).toEqual([0, 0]);

    drive(trail, truck, 10, 3); // 30 m: the first one is out, the second still waits in the yard.
    expect(Array.from(trail.shown)).toEqual([1, 0]);
    expect(trail.vehicleZ[0]).toBeCloseTo(20 + 30 - CONVOY_FOLLOW_GAPS[0], 0);

    drive(trail, truck, 15, 20);
    expect(Array.from(trail.shown)).toEqual([1, 1]);
    for (let i = 0; i < 2; i++) {
      expect(behind(trail, truck, i)).toBeCloseTo(CONVOY_FOLLOW_GAPS[i]!, 0);
      expect(trail.vehicleX[i]).toBeCloseTo(10, 6);
      expect(trail.vehicleHeading[i]).toBeCloseTo(0, 6);
    }
    expect(trail.trucksWithConvoy).toBe(2);
    expect(trail.lagging).toBe(false);
  });

  it('follows the way the truck drove round a bend', () => {
    // A circle of 60 m round (0, 0), the truck starting at (-60, 0) heading +z and turning right.
    const radius = 60;
    const speed = 15;
    const truck = { x: -radius, z: 0, heading: 0 };
    const trail = new ConvoyTrail(truck.x, truck.z);

    drive(trail, truck, speed, 12, speed / radius);

    for (let i = 0; i < 2; i++) {
      const x = trail.vehicleX[i]!;
      const z = trail.vehicleZ[i]!;
      expect(Math.sqrt(x * x + z * z)).toBeCloseTo(radius, 0);
      // Facing along the circle: at right angles to the way to its middle.
      const radial = Math.atan2(x, z);
      const across = Math.cos(trail.vehicleHeading[i]! - radial);
      expect(Math.abs(across)).toBeLessThan(0.05);
    }
  });

  it('falls behind a truck driven faster than it goes, the last one first, and is lost 250 m behind', () => {
    const truck = { x: 0, z: 0, heading: 0 };
    const trail = new ConvoyTrail(truck.x, truck.z);
    drive(trail, truck, 15, 6);

    const speed = 90 / 3.6;
    let warned = 0;
    const lost: number[] = [];
    for (let second = 0; second < 80 && lost.length < 2; second++) {
      lost.push(...drive(trail, truck, speed, 1));
      if (warned === 0 && trail.lagging) {
        warned = second;
      }
    }

    // The slower one (70 km/h) first, after about 250 m / 5.6 m/s; the other after 250 m / 4.4 m/s.
    expect(lost).toEqual([1, 0]);
    expect(warned).toBeGreaterThan(5);
    expect(warned).toBeLessThan(250 / (speed - CONVOY_TOP_SPEEDS[1]));
    expect(trail.trucksWithConvoy).toBe(0);
    expect(Array.from(trail.shown)).toEqual([0, 0]);
  });

  it('catches up again once the truck slows down', () => {
    const truck = { x: 0, z: 0, heading: 0 };
    const trail = new ConvoyTrail(truck.x, truck.z);
    drive(trail, truck, 15, 6);
    drive(trail, truck, 90 / 3.6, 20); // 100 m or more behind, short of being lost.
    expect(trail.lagging).toBe(true);
    expect(trail.trucksWithConvoy).toBe(2);

    drive(trail, truck, 40 / 3.6, 30);

    expect(trail.lagging).toBe(false);
    expect(behind(trail, truck, 0)).toBeCloseTo(CONVOY_FOLLOW_GAPS[0], 0);
    expect(behind(trail, truck, 1)).toBeCloseTo(CONVOY_FOLLOW_GAPS[1], 0);
  });

  it('backs up with the truck, and turning about leaves no loop to drive', () => {
    const truck = { x: 0, z: 0, heading: 0 };
    const trail = new ConvoyTrail(truck.x, truck.z);
    drive(trail, truck, 10, 10); // To z = 100: the followers at 76 and 54.

    drive(trail, truck, -2, 5); // Backs up 10 m along the way.
    expect(trail.vehicleZ[0]).toBeCloseTo(100 - 10 - CONVOY_FOLLOW_GAPS[0], 0);
    expect(trail.vehicleZ[1]).toBeCloseTo(100 - 10 - CONVOY_FOLLOW_GAPS[1], 0);

    // Backs out to the side, then drives off forward the other way: the way grows only once its end is behind.
    truck.heading = Math.PI / 2; // Facing +x.
    drive(trail, truck, -2, 4); // To x = -8.
    drive(trail, truck, 10, 8); // Forward to x = 72.
    let furthestZ = 0;
    for (let s = 0; s < 3; s++) {
      drive(trail, truck, 10, 1);
      furthestZ = Math.max(furthestZ, trail.vehicleZ[0]!);
    }
    // The first one turned the corner at z = 90 and never drove on toward z = 100.
    expect(furthestZ).toBeLessThanOrEqual(90 + 1e-6);
    expect(trail.vehicleZ[0]).toBeCloseTo(90, 0);
    expect(trail.vehicleHeading[0]).toBeCloseTo(Math.PI / 2, 1);
  });

  it('forms again behind the truck when it is put somewhere else (the ferry, a recovery)', () => {
    const truck = { x: 0, z: 0, heading: 0 };
    const trail = new ConvoyTrail(truck.x, truck.z);
    drive(trail, truck, 15, 6);
    expect(Array.from(trail.shown)).toEqual([1, 1]);

    truck.x = 2000;
    truck.z = -500;
    expect(trail.step(STEP, truck.x, truck.z, truck.heading)).toBe(-1);

    expect(Array.from(trail.shown)).toEqual([0, 0]);
    expect(trail.trucksWithConvoy).toBe(2);
    drive(trail, truck, 10, 6);
    expect(Array.from(trail.shown)).toEqual([1, 1]);
    expect(trail.vehicleX[0]).toBeCloseTo(2000, 6);
  });

  it('forms with the trucks a saved game had lost already lost, the last first', () => {
    const one = new ConvoyTrail(0, 0, 1);
    const none = new ConvoyTrail(0, 0, 2);

    expect(Array.from(one.present)).toEqual([1, 0]);
    expect(one.trucksWithConvoy).toBe(1);
    expect(none.trucksWithConvoy).toBe(0);
    expect(one.size).toBe(2);
  });

  it('loses no one to a truck that stands still for long', () => {
    const truck = { x: 0, z: 0, heading: 0 };
    const trail = new ConvoyTrail(truck.x, truck.z);
    drive(trail, truck, 12, 8);

    expect(drive(trail, truck, 0, 600)).toEqual([]);
    expect(trail.trucksWithConvoy).toBe(2);
    expect(CONVOY_LOST_METERS).toBeGreaterThan(CONVOY_FOLLOW_GAPS[1]);
  });
});
