import { describe, expect, it } from 'vitest';
import { TRAILER_TEXT_MAX, trailerText } from '../../../../src/domain/vehicles/trailerText';

describe('trailerText', () => {
  it('letters the text in capitals, by the player\'s language', () => {
    expect(trailerText('Kuzey Lojistik', 'tr')).toBe('KUZEY LOJİSTİK');
    expect(trailerText('Kuzey Logistics', 'en')).toBe('KUZEY LOGISTICS'.slice(0, TRAILER_TEXT_MAX).trim());
    expect(trailerText('Şahin & Oğul 24/7', 'tr')).toBe('ŞAHİN OĞUL 24/');
  });

  it('keeps only what the lettering can draw, runs spaces together and keeps it short', () => {
    expect(trailerText('  big   rig!!  ', 'en')).toBe('BIG RIG');
    expect(trailerText('A'.repeat(30), 'en')).toHaveLength(TRAILER_TEXT_MAX);
    expect(trailerText('🚚🚚', 'en')).toBeNull();
    expect(trailerText('   ', 'en')).toBeNull();
    // An unknown locale falls back to plain capitals.
    expect(trailerText('road', 'xx-invalid-locale-tag-!!')).toBe('ROAD');
  });
});
