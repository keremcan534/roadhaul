import { describe, expect, it } from 'vitest';
import type { CrateTierConfig } from '../../../../src/data/config/GameConfig';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { drawCrate, nextStreakCrate, streakCrate, type CratePaint } from '../../../../src/domain/rewards/crates';

const TIER: CrateTierConfig = { credits: [100, 300], paintChance: 0.5, rarityWeights: { rare: 1, epic: 1, legendary: 2 } };
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

describe('drawCrate', () => {
  it('pays credits between the tier\'s two, in tens', () => {
    expect(drawCrate(TIER, PAINTS, rolls(0, 0.9, 0, 0)).credits).toBe(100);
    expect(drawCrate(TIER, PAINTS, rolls(0.999, 0.9, 0, 0)).credits).toBe(300);
    expect(drawCrate(TIER, PAINTS, rolls(0.333, 0.9, 0, 0)).credits).toBe(170);
  });

  it('holds a colour by the paint chance, its rarity by weight, then one of that rarity evenly', () => {
    // Over the chance: credits alone.
    expect(drawCrate(TIER, PAINTS, rolls(0, 0.5, 0, 0)).paintId).toBeNull();
    // Rarity roll across weights 1 (rare), 1 (epic), 2 (legendary) of 4.
    expect(drawCrate(TIER, PAINTS, rolls(0, 0.1, 0.1, 0)).paintId).toBe('red');
    expect(drawCrate(TIER, PAINTS, rolls(0, 0.1, 0.1, 0.9)).paintId).toBe('blue');
    expect(drawCrate(TIER, PAINTS, rolls(0, 0.1, 0.3, 0)).paintId).toBe('violet');
    expect(drawCrate(TIER, PAINTS, rolls(0, 0.1, 0.9, 0)).paintId).toBe('gold');
  });

  it('draws only from the colours not got yet, and gives credits alone once every one is', () => {
    const left = PAINTS.filter((paint) => paint.rarity === 'epic');
    expect(drawCrate(TIER, left, rolls(0, 0.1, 0.99, 0)).paintId).toBe('violet');
    expect(drawCrate(TIER, [], rolls(0, 0.1, 0.5, 0))).toEqual({ credits: 100, paintId: null });
    // A rarity weighted 0 is never drawn.
    const noLegend: CrateTierConfig = { ...TIER, rarityWeights: { rare: 0, epic: 0, legendary: 0 } };
    expect(drawCrate(noLegend, PAINTS, rolls(0, 0.1, 0.5, 0)).paintId).toBeNull();
  });

  it('draws as many rolls whatever it holds, so a crate never changes the next one\'s luck', () => {
    let used = 0;
    const counting = (): number => {
      used += 1;
      return 0.9;
    };
    drawCrate(TIER, PAINTS, counting);
    drawCrate(TIER, [], counting);
    expect(used).toBe(8);
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
