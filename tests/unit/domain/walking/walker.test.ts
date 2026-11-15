import { describe, expect, it } from 'vitest';
import { createWalker, stepWalker, WALKING, type WalkerSolids } from '../../../../src/domain/walking/walker';

const OPEN: WalkerSolids = { pushOut: () => false };
const STEP = 1 / 60;

function walk(seconds: number, forward: number, turn: number, solids: WalkerSolids = OPEN) {
  const walker = createWalker();
  for (let t = 0; t < seconds - 1e-9; t += STEP) {
    stepWalker(walker, { forward, turn }, STEP, solids);
  }
  return walker;
}

describe('the walker', () => {
  it('walks ahead up to a jog, backs away slower, and stands still with no controls', () => {
    const ahead = walk(2, 1, 0);
    expect(ahead.speed).toBeCloseTo(WALKING.topSpeedMetersPerSecond, 6);
    // Up to speed in a third of a second: nearly two seconds' worth at full speed.
    expect(ahead.z).toBeGreaterThan(5.2);
    expect(ahead.x).toBeCloseTo(0, 9);
    const back = walk(2, -1, 0);
    expect(back.speed).toBeCloseTo(-WALKING.backSpeedMetersPerSecond, 6);
    expect(back.z).toBeLessThan(-1.9);
    expect(walk(2, 0, 0)).toMatchObject({ x: 0, z: 0, speed: 0 });
  });

  it("turns right for a positive turn (the heading falls, as the truck's), on the spot too", () => {
    const turned = walk(0.5, 0, 1);
    expect(turned.heading).toBeCloseTo(-WALKING.turnRadiansPerSecond * 0.5, 6);
    expect(turned.x).toBe(0);
    // Facing +z, a right turn heads toward -x.
    expect(walk(1, 1, 0.5).x).toBeLessThan(0);
  });

  it('is pushed out of what is solid, and its stride turns with how far it goes', () => {
    // A wall at z = 1: never further.
    const wall: WalkerSolids = {
      pushOut(at, radius) {
        if (at.z > 1 - radius) {
          at.z = 1 - radius;
          return true;
        }
        return false;
      },
    };
    const walker = walk(3, 1, 0, wall);
    expect(walker.z).toBeCloseTo(1 - WALKING.radiusMeters, 9);
    const strider = createWalker();
    stepWalker(strider, { forward: 0, turn: 0 }, STEP, OPEN);
    expect(strider.cycle).toBe(0);
    strider.speed = WALKING.topSpeedMetersPerSecond;
    stepWalker(strider, { forward: 1, turn: 0 }, 0.1, OPEN);
    expect(strider.cycle).toBeCloseTo((0.3 * 2 * Math.PI) / WALKING.strideMeters, 6);
  });
});
