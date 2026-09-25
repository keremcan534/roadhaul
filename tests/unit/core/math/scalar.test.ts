import { describe, expect, it } from 'vitest';
import {
  approach,
  clamp,
  clamp01,
  dampFactor,
  degreesToRadians,
  finiteOr,
  kmhToMetersPerSecond,
  lerp,
  metersPerSecondToKmh,
  smoothstep,
} from '../../../../src/core/math/scalar';

describe('scalar helpers', () => {
  it('clamps to a range', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
    expect(clamp01(1.5)).toBe(1);
  });

  it('replaces non-finite numbers', () => {
    expect(finiteOr(Number.NaN, 0)).toBe(0);
    expect(finiteOr(Number.POSITIVE_INFINITY, 1)).toBe(1);
    expect(finiteOr(0.25, 1)).toBe(0.25);
  });

  it('interpolates and approaches without overshooting', () => {
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(approach(0, 1, 0.3)).toBeCloseTo(0.3);
    expect(approach(0.9, 1, 0.3)).toBe(1);
    expect(approach(1, -1, 0.5)).toBe(0.5);
  });

  it('eases from 0 to 1 between two edges, flat outside them', () => {
    expect(smoothstep(2, 4, 1)).toBe(0);
    expect(smoothstep(2, 4, 3)).toBe(0.5);
    expect(smoothstep(2, 4, 5)).toBe(1);
    expect(smoothstep(2, 4, 2.5)).toBeCloseTo(0.15625, 12);
    // Reversed edges fall instead.
    expect(smoothstep(4, 2, 2.5)).toBeCloseTo(0.84375, 12);
  });

  it('damps the same total amount regardless of frame rate', () => {
    let at30 = 0;
    let at120 = 0;
    for (let frame = 0; frame < 30; frame++) {
      at30 += (1 - at30) * dampFactor(4, 1 / 30);
    }
    for (let frame = 0; frame < 120; frame++) {
      at120 += (1 - at120) * dampFactor(4, 1 / 120);
    }

    expect(at30).toBeCloseTo(at120, 10);
    expect(at30).toBeCloseTo(1 - Math.exp(-4), 10);
  });

  it('converts units', () => {
    expect(degreesToRadians(180)).toBeCloseTo(Math.PI);
    expect(kmhToMetersPerSecond(90)).toBe(25);
    expect(metersPerSecondToKmh(25)).toBe(90);
  });
});
