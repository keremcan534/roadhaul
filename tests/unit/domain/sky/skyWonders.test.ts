import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { auroraTonight } from '../../../../src/domain/sky/skyWonders';

describe('auroraTonight', () => {
  const chances = DEFAULT_GAME_CONFIG.skyWonders.auroraChance;

  it('brings the northern lights out on the season\'s share of the nights, most in winter', () => {
    expect(auroraTonight(0.49, 'winter', chances)).toBe(true);
    expect(auroraTonight(0.5, 'winter', chances)).toBe(false);
    expect(auroraTonight(0.2, 'autumn', chances)).toBe(true);
    expect(auroraTonight(0.2, 'summer', chances)).toBe(false);
    expect(chances.winter).toBeGreaterThan(chances.summer);
  });
});
