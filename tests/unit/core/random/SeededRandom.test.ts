import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../../../../src/core/random/SeededRandom';

function take(random: SeededRandom, count: number): number[] {
  return Array.from({ length: count }, () => random.next());
}

describe('SeededRandom', () => {
  it('repeats the same sequence for the same seed', () => {
    expect(take(new SeededRandom(42), 5)).toEqual(take(new SeededRandom(42), 5));
  });

  it('gives different sequences for different seeds', () => {
    expect(take(new SeededRandom(1), 5)).not.toEqual(take(new SeededRandom(2), 5));
  });

  it('stays in [0, 1) and spreads values evenly', () => {
    const values = take(new SeededRandom(7), 10_000);

    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
  });

  it('produces ranges, integers and signs within bounds', () => {
    const random = new SeededRandom(99);
    for (let i = 0; i < 1000; i++) {
      const value = random.range(-2, 3);
      expect(value).toBeGreaterThanOrEqual(-2);
      expect(value).toBeLessThan(3);
      const integer = random.int(1, 6);
      expect(Number.isInteger(integer)).toBe(true);
      expect(integer).toBeGreaterThanOrEqual(1);
      expect(integer).toBeLessThanOrEqual(6);
      expect([-1, 1]).toContain(random.sign());
    }
  });
});
