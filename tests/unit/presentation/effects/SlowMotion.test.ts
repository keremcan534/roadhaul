import { describe, expect, it } from 'vitest';
import { SlowMotion } from '../../../../src/presentation/effects/SlowMotion';

describe('SlowMotion', () => {
  it('runs at real time until triggered', () => {
    const slow = new SlowMotion();
    expect(slow.update(0.1)).toBe(1);
    expect(slow.active).toBe(false);
  });

  it('drops to under a third of real time at once, holds, then eases back to real time', () => {
    const slow = new SlowMotion();
    slow.trigger();
    expect(slow.active).toBe(true);
    expect(slow.update(0.016)).toBeLessThan(0.34);
    expect(slow.update(0.3)).toBeLessThan(0.34);
    let scale = 0;
    const scales: number[] = [];
    for (let i = 0; i < 60 && slow.active; i++) {
      scale = slow.update(1 / 60);
      scales.push(scale);
    }
    // Rising smoothly, never back down, to real time within the second.
    expect(scales).toEqual([...scales].sort((a, b) => a - b));
    expect(scale).toBe(1);
    expect(slow.active).toBe(false);
    expect(slow.update(0.1)).toBe(1);
  });

  it('starts over when triggered again, and ignores bad times', () => {
    const slow = new SlowMotion();
    slow.trigger();
    slow.update(0.5);
    slow.update(0.4);
    slow.trigger();
    expect(slow.update(Number.NaN)).toBeLessThan(0.34);
    expect(slow.update(-1)).toBeLessThan(0.34);
  });
});
