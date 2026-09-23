import { describe, expect, it } from 'vitest';
import { frozenCopy } from '../../../../src/core/objects/frozenCopy';

describe('frozenCopy', () => {
  it('copies instead of freezing the original', () => {
    const original = { stats: { speed: 90 }, tags: ['a'] };

    const copy = frozenCopy(original);

    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
    expect(copy.stats).not.toBe(original.stats);
    expect(Object.isFrozen(original)).toBe(false);
  });

  it('freezes every level', () => {
    const copy = frozenCopy({ stats: { speed: 90 }, tags: [{ name: 'a' }] });

    expect(Object.isFrozen(copy)).toBe(true);
    expect(Object.isFrozen(copy.stats)).toBe(true);
    expect(Object.isFrozen(copy.tags)).toBe(true);
    expect(Object.isFrozen(copy.tags[0])).toBe(true);
    expect(() => {
      (copy.stats as { speed: number }).speed = 200;
    }).toThrow(TypeError);
  });

  it('keeps a "__proto__" key from JSON as plain data instead of a prototype', () => {
    const parsed = JSON.parse('{"id":"m","__proto__":{"requiredVehicleClass":"flying"}}') as Record<string, unknown>;

    const copy = frozenCopy(parsed);

    expect(Object.hasOwn(copy, '__proto__')).toBe(true);
    expect(copy['requiredVehicleClass']).toBeUndefined();
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
  });

  it('returns primitives and null unchanged', () => {
    expect(frozenCopy(5)).toBe(5);
    expect(frozenCopy('id')).toBe('id');
    expect(frozenCopy(null)).toBeNull();
  });
});
