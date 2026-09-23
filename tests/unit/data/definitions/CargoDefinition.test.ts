import { describe, expect, it } from 'vitest';
import { Validator } from '../../../../src/core/validation/Validator';
import { CARGO } from '../../../../src/data/content/cargo';
import type { BodyType } from '../../../../src/data/definitions/BodyType';
import { validateCargoDefinition, type CargoDefinition } from '../../../../src/data/definitions/CargoDefinition';
import { cargoFixture } from '../../../support/contentFixtures';

function issues(cargo: CargoDefinition): { path: string; message: string }[] {
  const validator = new Validator();
  validateCargoDefinition(cargo, 'cargo', validator);
  return [...validator.issues];
}

describe('validateCargoDefinition', () => {
  it('accepts the built-in cargo and the test fixture', () => {
    for (const cargo of [...CARGO, cargoFixture()]) {
      expect(issues(cargo), cargo.id).toEqual([]);
    }
  });

  it('ships 6 to 8 cargo types, some of them for each body (spec §11)', () => {
    expect(CARGO.length).toBeGreaterThanOrEqual(6);
    expect(CARGO.length).toBeLessThanOrEqual(8);
    expect(new Set(CARGO.map((cargo) => cargo.requiredBody))).toEqual(new Set(['box', 'refrigerated', 'flatbed']));
  });

  it('requires a known body', () => {
    expect(issues(cargoFixture({ requiredBody: 'tanker' as BodyType })).map((issue) => issue.path)).toEqual([
      'cargo.requiredBody',
    ]);
  });

  it('keeps chilled and frozen cargo in refrigerated bodies', () => {
    expect(issues(cargoFixture({ temperature: 'frozen', requiredBody: 'box' }))).toEqual([
      { path: 'cargo.requiredBody', message: 'chilled and frozen cargo needs a refrigerated body' },
    ]);
    expect(issues(cargoFixture({ temperature: 'chilled', requiredBody: 'refrigerated' }))).toEqual([]);
    // Dry cargo may still travel refrigerated.
    expect(issues(cargoFixture({ temperature: 'none', requiredBody: 'refrigerated' }))).toEqual([]);
  });
});
