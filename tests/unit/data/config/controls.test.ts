import { describe, expect, it } from 'vitest';
import { weatherChoiceFor } from '../../../../src/data/config/controls';

describe('weatherChoiceFor', () => {
  it('shows the weather held, or as it comes while it changes by itself or is held as one not offered', () => {
    expect(weatherChoiceFor('rain')).toBe('rain');
    expect(weatherChoiceFor('cloudy')).toBe('cloudy');
    expect(weatherChoiceFor(null)).toBe('auto');
    expect(weatherChoiceFor('blizzard')).toBe('auto');
  });
});
