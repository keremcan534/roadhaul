import { describe, expect, it } from 'vitest';
import type { CrateTierConfig } from '../../../../src/data/config/GameConfig';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import {
  CRATE_ROLLS,
  drawCrate,
  freeCrateTier,
  nextStreakCrate,
  streakCrate,
  type CratePaint,
} from '../../../../src/domain/rewards/crates';

const TIER: CrateTierConfig = {
  credits: [100, 300],
  paintChance: 0.5,
  rarityWeights: { rare: 1, epic: 1, legendary: 2 },
  partsChance: 0.5,
  parts: [1, 4],
  boosterChance: 0.5,
};
const BOOSTERS = { pay_boost: 1, xp_boost: 1, free_refuel: 1, free_repair: 1 } as const;
const PAINTS: readonly CratePaint[] = [
  { id: 'red', rarity: 'rare' },
  { id: 'blue', rarity: 'rare' },
  { id: 'violet', rarity: 'epic' },
  { id: 'gold', rarity: 'legendary' },
];

/** A random source that answers `rolls` in turn. */
function rolls(...values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length]!;
}

/**
 * A crate drawn from these rolls, in the order drawCrate takes them: credits, paint?, rarity, which colour, parts?,
 * how many, booster?, which booster.
 */
function draw(credits: number, paint: number, rarity: number, pick: number, parts = 0.9, partCount = 0, booster = 0.9, kind = 0) {
  return drawCrate(TIER, PAINTS, rolls(credits, paint, rarity, pick, parts, partCount, booster, kind), BOOSTERS);
}

describe('drawCrate', () => {
  it('pays credits between the tier\'s two, in tens', () => {
    expect(draw(0, 0.9, 0, 0).credits).toBe(100);
    expect(draw(0.999, 0.9, 0, 0).credits).toBe(300);
    expect(draw(0.333, 0.9, 0, 0).credits).toBe(170);
  });

  it('holds a colour by the paint chance, its rarity by weight, then one of that rarity evenly', () => {
    // Over the chance: no colour.
    expect(draw(0, 0.5, 0, 0).paintId).toBeNull();
    // Rarity roll across weights 1 (rare), 1 (epic), 2 (legendary) of 4.
    expect(draw(0, 0.1, 0.1, 0).paintId).toBe('red');
    expect(draw(0, 0.1, 0.1, 0.9).paintId).toBe('blue');
    expect(draw(0, 0.1, 0.3, 0).paintId).toBe('violet');
    expect(draw(0, 0.1, 0.9, 0).paintId).toBe('gold');
  });

  it('draws only from the colours not got yet, and gives none once every one is', () => {
    const left = PAINTS.filter((paint) => paint.rarity === 'epic');
    expect(drawCrate(TIER, left, rolls(0, 0.1, 0.99, 0, 0.9, 0, 0.9, 0), BOOSTERS).paintId).toBe('violet');
    expect(drawCrate(TIER, [], rolls(0, 0.1, 0.5, 0, 0.9, 0, 0.9, 0), BOOSTERS)).toEqual({
      credits: 100,
      paintId: null,
      liveryId: null,
      parts: 0,
      booster: null,
    });
    // A design drawn is given as one.
    const designs: readonly CratePaint[] = [{ id: 'galaxy', rarity: 'legendary', kind: 'livery' }];
    expect(drawCrate(TIER, designs, rolls(0, 0.1, 0.5, 0, 0.9, 0, 0.9, 0), BOOSTERS)).toMatchObject({ paintId: null, liveryId: 'galaxy' });
    // A rarity weighted 0 is never drawn.
    const noColours: CrateTierConfig = { ...TIER, rarityWeights: { rare: 0, epic: 0, legendary: 0 } };
    expect(drawCrate(noColours, PAINTS, rolls(0, 0.1, 0.5, 0, 0.9, 0, 0.9, 0), BOOSTERS).paintId).toBeNull();
  });

  it('holds upgrade parts by their chance, as many as drawn between the two', () => {
    expect(draw(0, 0.9, 0, 0, 0.9, 0.5).parts).toBe(0);
    expect(draw(0, 0.9, 0, 0, 0.1, 0).parts).toBe(1);
    expect(draw(0, 0.9, 0, 0, 0.1, 0.99).parts).toBe(4);
  });

  it('holds a booster by its chance, its kind by weight', () => {
    expect(draw(0, 0.9, 0, 0, 0.9, 0, 0.9, 0.1).booster).toBeNull();
    expect(draw(0, 0.9, 0, 0, 0.9, 0, 0.1, 0.1).booster).toBe('pay_boost');
    expect(draw(0, 0.9, 0, 0, 0.9, 0, 0.1, 0.3).booster).toBe('xp_boost');
    expect(draw(0, 0.9, 0, 0, 0.9, 0, 0.1, 0.9).booster).toBe('free_repair');
  });

  it('draws as many rolls whatever it holds, so a crate never changes the next one\'s luck', () => {
    let used = 0;
    const counting = (): number => {
      used += 1;
      return used % 2 === 0 ? 0.1 : 0.9;
    };
    drawCrate(TIER, PAINTS, counting, BOOSTERS);
    drawCrate(TIER, [], counting, BOOSTERS);
    expect(used).toBe(2 * CRATE_ROLLS);
  });
});

describe('freeCrateTier', () => {
  it('draws the free crate\'s tier by its weights', () => {
    const weights = { bronze: 75, silver: 20, gold: 5 };
    expect(freeCrateTier(0, weights)).toBe('bronze');
    expect(freeCrateTier(0.8, weights)).toBe('silver');
    expect(freeCrateTier(0.97, weights)).toBe('gold');
  });
});

describe('streakCrate', () => {
  const rule = DEFAULT_GAME_CONFIG.crates.perfectStreak;

  it('gives bronze every third perfect delivery, silver every fifth and gold every tenth, the best of them', () => {
    const tiers = Array.from({ length: 20 }, (_, index) => streakCrate(index + 1, rule));
    expect(tiers).toEqual([
      null, null, 'bronze', null, 'silver', 'bronze', null, null, 'bronze', 'gold',
      null, 'bronze', null, null, 'silver', null, null, 'bronze', null, 'gold',
    ]);
    expect(streakCrate(0, rule)).toBeNull();
  });

  it('tells how far the next crate is, and which', () => {
    expect(nextStreakCrate(0, rule)).toEqual({ deliveries: 3, tier: 'bronze' });
    expect(nextStreakCrate(3, rule)).toEqual({ deliveries: 2, tier: 'silver' });
    expect(nextStreakCrate(9, rule)).toEqual({ deliveries: 1, tier: 'gold' });
  });
});
