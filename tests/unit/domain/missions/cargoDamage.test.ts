import { describe, expect, it } from 'vitest';
import {
  addCargoDamage,
  CARGO_DESTROYING_IMPACT_SPEED,
  cargoDamageFromImpact,
  isWithinTolerance,
} from '../../../../src/domain/missions/cargoDamage';

describe('cargo damage', () => {
  it('destroys fully fragile cargo in a crash at the destroying speed', () => {
    expect(cargoDamageFromImpact(CARGO_DESTROYING_IMPACT_SPEED, 1)).toBeCloseTo(1, 12);
    expect(cargoDamageFromImpact(CARGO_DESTROYING_IMPACT_SPEED * 2, 1)).toBe(1);
  });

  it('grows with the square of the impact speed', () => {
    const half = cargoDamageFromImpact(CARGO_DESTROYING_IMPACT_SPEED / 2, 1);

    expect(half).toBeCloseTo(0.25, 12);
    expect(cargoDamageFromImpact(CARGO_DESTROYING_IMPACT_SPEED / 4, 1)).toBeCloseTo(half / 4, 12);
  });

  it('scales with how sensitive the cargo is', () => {
    expect(cargoDamageFromImpact(7, 0.3)).toBeCloseTo(0.3 * 0.25, 12);
    expect(cargoDamageFromImpact(7, 0)).toBe(0);
  });

  it('treats no impact, or a bad value, as no damage', () => {
    expect(cargoDamageFromImpact(0, 1)).toBe(0);
    expect(cargoDamageFromImpact(-5, 1)).toBe(0);
  });

  it('adds up hits, capped at destroyed', () => {
    expect(addCargoDamage(0.25, 0.5)).toBeCloseTo(0.75, 12);
    expect(addCargoDamage(0.75, 0.5)).toBe(1);
  });

  it('accepts damage up to the tolerance, inclusive', () => {
    expect(isWithinTolerance(0.1, 0.1)).toBe(true);
    expect(isWithinTolerance(0.11, 0.1)).toBe(false);
    expect(isWithinTolerance(0, 0)).toBe(true);
  });
});
