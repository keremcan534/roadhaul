import { describe, expect, it } from 'vitest';
import { ValidationError, Validator } from '../../../../src/core/validation/Validator';

describe('Validator', () => {
  it('accepts snake_case ids and rejects anything else', () => {
    const validator = new Validator();

    expect(validator.id('rh_h1', 'a')).toBe(true);
    expect(validator.id('frozen_food_2', 'b')).toBe(true);
    expect(validator.id('Truck', 'c')).toBe(false);
    expect(validator.id('two__underscores', 'd')).toBe(false);
    expect(validator.id('trailing_', 'e')).toBe(false);
    expect(validator.id('', 'f')).toBe(false);
    expect(validator.id(42, 'g')).toBe(false);

    expect(validator.issues.map((issue) => issue.path)).toEqual(['c', 'd', 'e', 'f', 'g']);
  });

  it('checks number ranges', () => {
    const validator = new Validator();

    expect(validator.positiveNumber(0.5, 'p1')).toBe(true);
    expect(validator.positiveNumber(0, 'p2')).toBe(false);
    expect(validator.positiveNumber(Number.POSITIVE_INFINITY, 'p3')).toBe(false);
    expect(validator.positiveInteger(3, 'i1')).toBe(true);
    expect(validator.positiveInteger(0, 'i2')).toBe(false);
    expect(validator.nonNegativeInteger(0, 'n1')).toBe(true);
    expect(validator.nonNegativeInteger(1.5, 'n2')).toBe(false);
    expect(validator.fraction(0, 'f1')).toBe(true);
    expect(validator.fraction(1, 'f2')).toBe(true);
    expect(validator.fraction(1.01, 'f3')).toBe(false);
    expect(validator.fraction('0.5', 'f4')).toBe(false);

    expect(validator.issues.map((issue) => issue.path)).toEqual(['p2', 'p3', 'i2', 'n2', 'f3', 'f4']);
  });

  it('checks allowed values and booleans', () => {
    const validator = new Validator();

    expect(validator.oneOf('rain', ['clear', 'rain'], 'weather')).toBe(true);
    expect(validator.oneOf('snow', ['clear', 'rain'], 'weather')).toBe(false);
    expect(validator.boolean(false, 'flag')).toBe(true);
    expect(validator.boolean(0, 'flag')).toBe(false);

    expect(validator.issues[0]?.message).toBe('must be one of clear, rain, got "snow"');
  });

  it('describes non-string values unambiguously in messages', () => {
    const validator = new Validator();

    validator.positiveNumber([5], 'array');
    validator.positiveNumber([], 'empty');
    validator.positiveNumber(Object.create(null) as object, 'bare');
    validator.positiveNumber({ speed: 90 }, 'object');
    validator.positiveNumber(undefined, 'missing');

    expect(validator.issues.map((issue) => issue.message)).toEqual([
      'must be a positive number, got [5]',
      'must be a positive number, got []',
      'must be a positive number, got {}',
      'must be a positive number, got {"speed":90}',
      'must be a positive number, got undefined',
    ]);
  });

  it('throws one error that lists every issue', () => {
    const validator = new Validator();
    validator.report('vehicles[0].id', 'duplicate id "rh_h1"');
    validator.report('missions[1].cargoId', 'unknown cargo "gold"');

    let thrown: unknown;
    try {
      validator.throwIfInvalid('Game content');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ValidationError);
    const error = thrown as ValidationError;
    expect(error.issues).toHaveLength(2);
    expect(error.message).toBe(
      'Game content is invalid (2 issues):\n' +
        '  - vehicles[0].id: duplicate id "rh_h1"\n' +
        '  - missions[1].cargoId: unknown cargo "gold"',
    );
  });

  it('does not throw when there are no issues', () => {
    expect(() => new Validator().throwIfInvalid('Anything')).not.toThrow();
  });
});
