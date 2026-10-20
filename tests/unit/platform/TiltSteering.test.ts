import { describe, expect, it } from 'vitest';
import { TiltSteering } from '../../../src/platform/input/TiltSteering';

const G = 9.81;
const RADIANS = Math.PI / 180;

/** Which of the phone's own axes points up the screen as the player holds it. */
const ORIENTATIONS = {
  portrait: [0, 1],
  'landscape, top to the left': [1, 0],
  'landscape, top to the right': [-1, 0],
  'upside down': [0, -1],
} as const;
type Orientation = keyof typeof ORIENTATIONS;
/** The screen's turn from the phone's natural orientation for each (the screen orientation API's angle). */
const SCREEN_ANGLES: Readonly<Record<Orientation, number>> = {
  portrait: 0,
  'landscape, top to the left': 90,
  'landscape, top to the right': 270,
  'upside down': 180,
};

interface Hold {
  readonly orientation?: Orientation;
  /** Turned like a steering wheel, degrees; clockwise (seen from the front) is positive. */
  readonly turn?: number;
  /** Tipped back from upright, degrees: 0 faces the player square on, 90 lies flat. */
  readonly back?: number;
  /** Browsers that report gravity with the opposite sign on all three axes. */
  readonly flipped?: boolean;
}

/**
 * What the accelerometer reads, gravity included, for a phone held so. At
 * rest it reads "up": turning the phone clockwise swings that anticlockwise
 * in the phone's own axes, and tipping it back moves it out of the screen.
 */
function reading({ orientation = 'portrait', turn = 0, back = 0, flipped = false }: Hold): [number, number, number, number] {
  const [upX, upY] = ORIENTATIONS[orientation];
  const cos = Math.cos(turn * RADIANS);
  const sin = Math.sin(turn * RADIANS);
  const inPlane = G * Math.cos(back * RADIANS);
  const sign = flipped ? -1 : 1;
  return [
    sign * inPlane * (upX * cos - upY * sin),
    sign * inPlane * (upX * sin + upY * cos),
    sign * G * Math.sin(back * RADIANS),
    SCREEN_ANGLES[orientation],
  ];
}

/**
 * The steering a turn of the phone asks for: nothing within the 3° dead zone, then along the response curve (55% of it
 * with the cube of the turn) to full lock at `fullLock` degrees (normal sensitivity's 32°).
 */
function lock(turn: number, fullLock = 32): number {
  const share = Math.min(1, Math.max(0, Math.abs(turn) - 3) / (fullLock - 3));
  return Math.sign(turn) * (share * 0.45 + share ** 3 * 0.55);
}

/** Reads `straight`, then `now`: the steering it asks for. */
function steerFor(straight: Hold, now: Hold, steering = new TiltSteering('normal')): number {
  expect(steering.read(...reading(straight))).toBe(true);
  expect(steering.read(...reading({ ...straight, ...now }))).toBe(true);
  steering.update(10); // Long enough to arrive.
  return steering.steer;
}

describe('TiltSteering', () => {
  for (const orientation of Object.keys(ORIENTATIONS) as Orientation[]) {
    for (const flipped of [false, true]) {
      it(`steers like a wheel held ${orientation}${flipped ? ', with gravity reported flipped' : ''}`, () => {
        // Tipped back further than about 55°, turns count a little less (see 'stays steady down to a phone held flat').
        for (const back of [0, 35, 55]) {
          const held = { orientation, back, flipped };
          expect(steerFor(held, {}), `straight, ${back}° back`).toBe(0);
          // Normal sensitivity: halfway to full lock steers gently, under a third.
          expect(steerFor(held, { turn: 17 }), `clockwise, ${back}° back`).toBeCloseTo(lock(17), 5);
          expect(steerFor(held, { turn: -17 }), `anticlockwise, ${back}° back`).toBeCloseTo(lock(-17), 5);
          expect(lock(17)).toBeLessThan(0.3);
          expect(steerFor(held, { turn: 40 })).toBe(1);
          expect(steerFor(held, { turn: -70 })).toBe(-1);
        }
      });
    }
  }

  it('ignores small turns and tipping the phone back or forward', () => {
    const held = { orientation: 'landscape, top to the left', back: 40 } as const;
    expect(steerFor(held, { turn: 2.5 })).toBe(0);
    expect(steerFor(held, { turn: -2.5 })).toBe(0);
    expect(steerFor(held, { back: 10 })).toBe(0);
    expect(steerFor(held, { back: 75 })).toBe(0);
    expect(steerFor(held, { back: 90 })).toBe(0);
  });

  it('steers gently for a small turn, and smoothly more to full lock', () => {
    const held = { orientation: 'landscape, top to the left', back: 40 } as const;
    // Held a few degrees askew, the truck barely turns: a correction, not a weave.
    expect(steerFor(held, { turn: 5 })).toBeLessThan(0.04);
    let before = 0;
    for (let turn = 4; turn <= 32; turn += 2) {
      const now = steerFor(held, { turn });
      expect(now, `${turn}°`).toBeGreaterThan(before);
      before = now;
    }
    expect(before).toBe(1);
  });

  it('turns less for full lock the more sensitive it is set', () => {
    const held = { orientation: 'landscape, top to the right', back: 30 } as const;
    expect(steerFor(held, { turn: 17 }, new TiltSteering('low'))).toBeCloseTo(lock(17, 45), 5);
    expect(steerFor(held, { turn: 17 }, new TiltSteering('high'))).toBeCloseTo(lock(17, 22), 5);
    const steering = new TiltSteering('low');
    steering.sensitivity = 'normal';
    expect(steerFor(held, { turn: 17 }, steering)).toBeCloseTo(lock(17), 5);
  });

  it('stays steady down to a phone held flat', () => {
    // Tipped far back, turning the phone moves gravity along the screen only a little: gentler, never wild.
    const held = { orientation: 'landscape, top to the left', back: 40 } as const;
    const nearlyFlat = steerFor(held, { back: 75, turn: 20 });
    expect(nearlyFlat).toBeGreaterThan(0.1);
    expect(nearlyFlat).toBeLessThan(steerFor(held, { turn: 20 }));
    // Flat, rocked 3° about the screen's upright axis: a gentle turn.
    const steering = new TiltSteering('normal');
    steering.read(...reading(held));
    const rock = 3 * RADIANS;
    steering.read(0, -G * Math.sin(rock), G * Math.cos(rock), 90);
    steering.update(10);
    expect(Math.abs(steering.steer)).toBeGreaterThan(0);
    expect(Math.abs(steering.steer)).toBeLessThan(0.25);
  });

  it('waits for the phone to leave the flat before steering', () => {
    const steering = new TiltSteering('normal');
    expect(steering.read(...reading({ back: 85 }))).toBe(false);
    expect(steering.isCalibrated).toBe(false);
    expect(steering.read(...reading({ back: 50 }))).toBe(true);
    expect(steering.isCalibrated).toBe(true);
  });

  it('skips readings that are not gravity', () => {
    const steering = new TiltSteering('normal');
    steering.read(...reading({}));
    steering.read(...reading({ turn: 17 }));
    const broken: [number, number, number][] = [
      [Number.NaN, G, 0],
      [0, Number.POSITIVE_INFINITY, 0],
      [0.5, 1, 0.5],
    ];
    for (const values of broken) {
      expect(steering.read(...values)).toBe(false);
    }
    steering.update(10);
    expect(steering.steer).toBeCloseTo(lock(17), 5);
  });

  it('eases toward the phone, and lets go at once', () => {
    const steering = new TiltSteering('normal');
    steering.read(...reading({}));
    steering.read(...reading({ turn: 40 }));
    steering.update(1 / 60);
    expect(steering.steer).toBeGreaterThan(0.1);
    expect(steering.steer).toBeLessThan(0.4);
    for (let frame = 0; frame < 60; frame++) {
      steering.update(1 / 60);
    }
    expect(steering.steer).toBe(1);

    steering.reset();
    expect(steering.steer).toBe(0);
    expect(steering.isCalibrated).toBe(false);
  });

  it('steers from level whatever the phone read first, so no reading on the way can set it askew', () => {
    // The phone picked up turned 15° (or tapped into the game so): that is a turn, not straight ahead.
    for (const orientation of Object.keys(ORIENTATIONS) as Orientation[]) {
      const steering = new TiltSteering('normal');
      steering.read(...reading({ orientation, turn: 15 }));
      steering.update(10);
      expect(steering.steer, orientation).toBeCloseTo(lock(15), 5);
      steering.read(...reading({ orientation }));
      steering.update(10);
      expect(steering.steer, orientation).toBe(0);
    }
  });

  it('takes the phone as it is held, averaged over a moment, as straight ahead when recentred, and back to level', () => {
    const steering = new TiltSteering('normal');
    const held = { orientation: 'landscape, top to the left', turn: -10 } as const;
    for (let frame = 0; frame < 30; frame++) {
      steering.read(...reading(held));
      steering.update(1 / 60);
    }
    steering.recenter();
    steering.update(10);
    expect(steering.steer).toBe(0);
    steering.read(...reading({ ...held, turn: 7 }));
    steering.update(10);
    expect(steering.steer).toBeCloseTo(lock(17), 5);
    // Level again (into the game, out of the menus): -10° is a turn left.
    steering.level();
    steering.read(...reading(held));
    steering.update(10);
    expect(steering.steer).toBeCloseTo(lock(-10), 5);
  });

  it('never takes more than 20° from level as straight ahead', () => {
    const steering = new TiltSteering('normal');
    steering.read(...reading({ turn: 45 }));
    steering.update(10);
    steering.recenter();
    steering.read(...reading({ turn: 20 }));
    steering.update(10);
    expect(steering.steer).toBe(0);
  });
});
