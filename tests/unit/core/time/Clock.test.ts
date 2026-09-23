import { describe, expect, it } from 'vitest';
import { shiftedClock } from '../../../../src/core/time/Clock';

describe('shiftedClock', () => {
  it('tells its base clock\'s time moved by the offset, and keeps ticking with it', () => {
    let now = 1_000;
    const base = { now: () => now };
    const shifted = shiftedClock(base, 5_000);

    expect(shifted.now()).toBe(6_000);
    now += 250;
    expect(shifted.now()).toBe(6_250);
  });
});
