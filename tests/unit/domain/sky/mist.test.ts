import { describe, expect, it } from 'vitest';
import { morningMist } from '../../../../src/domain/sky/mist';

describe('morningMist', () => {
  it('gathers before dawn, lies full round sunrise and lifts as the sun climbs, only in the morning', () => {
    const at = (degrees: number, rising = true) => morningMist(degrees, rising, 0, 0.55, 1);
    expect(at(-30)).toBe(0);
    expect(at(-10)).toBeGreaterThan(0);
    expect(at(-10)).toBeLessThan(at(-5));
    expect(at(-5)).toBe(1);
    expect(at(0)).toBe(1);
    expect(at(8)).toBeGreaterThan(0);
    expect(at(8)).toBeLessThan(1);
    expect(at(15)).toBe(0);
    expect(at(40)).toBe(0);
    // The same sun in the evening: none.
    expect(at(0, false)).toBe(0);
    expect(at(-8, false)).toBe(0);
  });

  it('lies thinner under cloud and on dry ground, and not at all in the rain', () => {
    const full = morningMist(0, true, 0, 0.55, 1);
    expect(morningMist(0, true, 0, 1, 1)).toBeCloseTo(0.3 * full, 9);
    expect(morningMist(0, true, 0, 0.55, 0)).toBeCloseTo(0.7 * full, 9);
    expect(morningMist(0, true, 1, 0.55, 1)).toBe(0);
    expect(morningMist(0, true, 0.5, 0.55, 1)).toBeCloseTo(0.25, 9);
  });
});
