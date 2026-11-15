import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { dirtLevel, dirtThrownUp } from '../../../../src/domain/vehicles/roadDirt';

const CONFIG = DEFAULT_GAME_CONFIG.roadDirt;
const DRY = { wetness: 0, snowy: false, offRoad: false };

describe('road dirt', () => {
  it('cakes a truck after so many kilometres of dry road, faster on a wet one, in the snow and fastest off the road', () => {
    expect(dirtThrownUp(CONFIG.dryKilometers * 1000, DRY, CONFIG)).toBeCloseTo(1, 9);
    expect(dirtThrownUp(1000, DRY, CONFIG)).toBeCloseTo(1 / CONFIG.dryKilometers, 9);
    expect(dirtThrownUp(1000, { ...DRY, wetness: 1 }, CONFIG)).toBeCloseTo(CONFIG.wetFactor / CONFIG.dryKilometers, 9);
    // Half wet, half the extra spray.
    expect(dirtThrownUp(1000, { ...DRY, wetness: 0.5 }, CONFIG)).toBeCloseTo((1 + (CONFIG.wetFactor - 1) / 2) / CONFIG.dryKilometers, 9);
    expect(dirtThrownUp(1000, { ...DRY, snowy: true }, CONFIG)).toBeCloseTo(CONFIG.snowFactor / CONFIG.dryKilometers, 9);
    expect(dirtThrownUp(1000, { ...DRY, offRoad: true, wetness: 1 }, CONFIG)).toBeCloseTo(CONFIG.offRoadFactor / CONFIG.dryKilometers, 9);
    expect(dirtThrownUp(-50, DRY, CONFIG)).toBe(0);
  });

  it('looks clean, dusty, dirty or filthy as the dirt piles up', () => {
    expect([0, 0.1, 0.2, 0.5, 0.8, 1].map(dirtLevel)).toEqual(['clean', 'clean', 'dusty', 'dirty', 'filthy', 'filthy']);
  });
});
