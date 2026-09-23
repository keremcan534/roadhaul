import { describe, expect, it } from 'vitest';
import { validateCompanyName } from '../../../../src/domain/company/companyName';

describe('validateCompanyName', () => {
  it.each([
    ['RoadHaul', 'RoadHaul'],
    ['  Kuzey Lojistik  ', 'Kuzey Lojistik'],
    ['Şahin \t  Nakliyat', 'Şahin Nakliyat'],
    ['AB', 'AB'],
    ['Tır 🚚', 'Tır 🚚'],
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
    ['ㅤㅤ', 'invalidCharacters'],
    ['⠀⠀⠀', 'invalidCharacters'],
    ['́́', 'invalidCharacters'],
    ['!!', 'invalidCharacters'],
    ['🚚🚚', 'invalidCharacters'],
  ])('rejects %j as %s', (input, error) => {
    expect(validateCompanyName(input)).toEqual({ ok: false, error });
  });

  it('composes decomposed letters, so "Ş" typed as S + cedilla counts once', () => {
    const decomposed = 'Şahin Lojistik';

    expect(validateCompanyName(decomposed)).toEqual({ ok: true, value: 'Şahin Lojistik' });
    expect(validateCompanyName(`${decomposed}1234567890`)).toEqual({
      ok: true,
      value: 'Şahin Lojistik1234567890',
    });
  });

  it('counts characters rather than UTF-16 code units', () => {
    const longest = `Tır${'🚚'.repeat(21)}`;

    expect(longest.length).toBe(45);
    expect(validateCompanyName(longest).ok).toBe(true);
    expect(validateCompanyName(`${longest}🚚`)).toEqual({ ok: false, error: 'tooLong' });
  });
});
