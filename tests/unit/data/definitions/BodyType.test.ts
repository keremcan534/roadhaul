import { describe, expect, it } from 'vitest';
import { BODY_TYPES, bodyCanHaul, type BodyType } from '../../../../src/data/definitions/BodyType';

describe('bodyCanHaul', () => {
  it('lets each body carry its own cargo', () => {
    for (const body of BODY_TYPES) {
      expect(bodyCanHaul(body, body), body).toBe(true);
    }
  });

  it('lets a refrigerated box carry dry box cargo, but not the other way round', () => {
    expect(bodyCanHaul('refrigerated', 'box')).toBe(true);
    expect(bodyCanHaul('box', 'refrigerated')).toBe(false);
  });

  it('keeps flatbed cargo on flatbeds and boxed cargo off them', () => {
    expect(bodyCanHaul('box', 'flatbed')).toBe(false);
    expect(bodyCanHaul('refrigerated', 'flatbed')).toBe(false);
    expect(bodyCanHaul('flatbed', 'box')).toBe(false);
    expect(bodyCanHaul('flatbed', 'refrigerated')).toBe(false);
  });

  it('refuses unknown bodies instead of throwing', () => {
    expect(bodyCanHaul('tanker' as BodyType, 'box')).toBe(false);
    expect(bodyCanHaul('box', 'tanker' as BodyType)).toBe(false);
  });
});
