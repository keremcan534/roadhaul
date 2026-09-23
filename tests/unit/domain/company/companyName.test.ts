import { describe, expect, it } from 'vitest';
import { validateCompanyName } from '../../../../src/domain/company/companyName';

describe('validateCompanyName', () => {
  it.each([
    ['RoadHaul', 'RoadHaul'],
    ['  Kuzey Lojistik  ', 'Kuzey Lojistik'],
    ['Şahin \t  Nakliyat', 'Şahin Nakliyat'],
    ['AB', 'AB'],
  ])('accepts %j as %j', (input, expected) => {
    expect(validateCompanyName(input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['', 'tooShort'],
    ['   ', 'tooShort'],
    ['A', 'tooShort'],
    ['x'.repeat(25), 'tooLong'],
    ['Road\u0007Haul', 'invalidCharacters'],
    ['Road​Haul', 'invalidCharacters'],
  ])('rejects %j as %s', (input, error) => {
    expect(validateCompanyName(input)).toEqual({ ok: false, error });
  });

  it('counts characters rather than UTF-16 code units', () => {
    const twelveTrucks = '🚚'.repeat(12);

    expect(twelveTrucks.length).toBe(24);
    expect(validateCompanyName(twelveTrucks).ok).toBe(true);
    expect(validateCompanyName('🚚'.repeat(25))).toEqual({ ok: false, error: 'tooLong' });
  });
});
