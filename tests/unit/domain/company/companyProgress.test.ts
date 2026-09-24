import { describe, expect, it } from 'vitest';
import { levelForXp, levelProgress } from '../../../../src/domain/company/companyProgress';

const LEVEL_XP = [0, 1000, 3000, 6500, 12000];

describe('company progression', () => {
  it('finds the level for an amount of XP', () => {
    expect(levelForXp(0, LEVEL_XP)).toBe(1);
    expect(levelForXp(999, LEVEL_XP)).toBe(1);
    expect(levelForXp(1000, LEVEL_XP)).toBe(2);
    expect(levelForXp(11_999, LEVEL_XP)).toBe(4);
    expect(levelForXp(1_000_000, LEVEL_XP)).toBe(5);
  });

  it('reports progress through the current level', () => {
    expect(levelProgress(2000, LEVEL_XP)).toEqual({ level: 2, xpIntoLevel: 1000, xpForLevel: 2000, fraction: 0.5 });
    expect(levelProgress(0, LEVEL_XP)).toEqual({ level: 1, xpIntoLevel: 0, xpForLevel: 1000, fraction: 0 });
  });

  it('shows the top level as full', () => {
    expect(levelProgress(15_000, LEVEL_XP)).toEqual({ level: 5, xpIntoLevel: 3000, xpForLevel: null, fraction: 1 });
  });
});
