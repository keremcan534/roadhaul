import { describe, expect, it } from 'vitest';
import { Validator } from '../../../../src/core/validation/Validator';
import { PAINTS } from '../../../../src/data/content/paints';
import { validatePaintDefinition, type PaintDefinition } from '../../../../src/data/definitions/PaintDefinition';
import { paintFixture } from '../../../support/contentFixtures';

function paths(paint: PaintDefinition): string[] {
  const validator = new Validator();
  validatePaintDefinition(paint, 'paint', validator);
  return validator.issues.map((issue) => issue.path);
}

describe('validatePaintDefinition', () => {
  it('accepts the built-in paints and the test fixture', () => {
    for (const paint of [...PAINTS, paintFixture()]) {
      expect(paths(paint), paint.id).toEqual([]);
    }
  });

  it('ships distinct colours, some kept for bigger companies', () => {
    expect(new Set(PAINTS.map((paint) => paint.color)).size).toBe(PAINTS.length);
    expect(PAINTS.some((paint) => (paint.requiredCompanyLevel ?? 1) > 1)).toBe(true);
    expect(PAINTS.some((paint) => (paint.requiredCompanyLevel ?? 1) === 1)).toBe(true);
  });

  it('reports a bad id, colour, price or level', () => {
    expect(paths(paintFixture({ id: 'Red Paint' }))).toEqual(['paint.id']);
    for (const color of [-1, 0x1000000, 1.5, Number.NaN]) {
      expect(paths(paintFixture({ color })), String(color)).toEqual(['paint.color']);
    }
    expect(paths(paintFixture({ price: 0 }))).toEqual(['paint.price']);
    expect(paths(paintFixture({ requiredCompanyLevel: 0 }))).toEqual(['paint.requiredCompanyLevel']);
  });
});
