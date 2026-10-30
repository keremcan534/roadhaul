import type { CrateTier, CrateTierConfig, GameConfig } from '../../data/config/GameConfig';
import { PAINT_RARITIES, type PaintRarity } from '../../data/definitions/PaintDefinition';
import type { Credits } from '../../data/units';

/** A colour only crates hold, as a crate draws from them. */
export interface CratePaint {
  readonly id: string;
  readonly rarity: PaintRarity;
}

/** What a crate held. */
export interface CrateContents {
  readonly credits: Credits;
  /** A crate colour the company had not got yet, or null. */
  readonly paintId: string | null;
}

/**
 * What a crate of `config`'s tier holds, drawn with `random` (uniform in
 * [0, 1)): credits between its two, and by its paint chance a crate colour
 * from those the company has not got yet (`unowned`), its rarity by the
 * tier's weights, then one of that rarity evenly. With every colour got,
 * credits alone.
 */
export function drawCrate(config: CrateTierConfig, unowned: readonly CratePaint[], random: () => number): CrateContents {
  const [least, most] = config.credits;
  // In tens, as the rest of the game's rewards.
  const credits = Math.round((least + (most - least) * random()) / 10) * 10;
  const withPaint = random() < config.paintChance;
  const roll = random();
  const pick = random();
  if (!withPaint || unowned.length === 0) {
    return { credits, paintId: null };
  }
  let total = 0;
  for (const rarity of PAINT_RARITIES) {
    if (unowned.some((paint) => paint.rarity === rarity)) {
      total += config.rarityWeights[rarity];
    }
  }
  if (total <= 0) {
    return { credits, paintId: null };
  }
  let left = roll * total;
  let chosen: PaintRarity = PAINT_RARITIES[0];
  for (const rarity of PAINT_RARITIES) {
    if (!unowned.some((paint) => paint.rarity === rarity) || config.rarityWeights[rarity] <= 0) {
      continue;
    }
    chosen = rarity;
    left -= config.rarityWeights[rarity];
    if (left < 0) {
      break;
    }
  }
  const ofRarity = unowned.filter((paint) => paint.rarity === chosen);
  return { credits, paintId: ofRarity[Math.min(ofRarity.length - 1, Math.floor(pick * ofRarity.length))]!.id };
}

/**
 * The crate a perfect streak of `streak` deliveries in a row earns, if any:
 * gold on every `goldEvery`th, else silver on every `silverEvery`th, else
 * bronze on every `bronzeEvery`th.
 */
export function streakCrate(streak: number, rule: GameConfig['crates']['perfectStreak']): CrateTier | null {
  if (streak <= 0) {
    return null;
  }
  if (streak % rule.goldEvery === 0) {
    return 'gold';
  }
  if (streak % rule.silverEvery === 0) {
    return 'silver';
  }
  return streak % rule.bronzeEvery === 0 ? 'bronze' : null;
}

/** The next crate the perfect streak earns after `streak`: how many more deliveries, and which. */
export function nextStreakCrate(
  streak: number,
  rule: GameConfig['crates']['perfectStreak'],
): { readonly deliveries: number; readonly tier: CrateTier } {
  for (let next = Math.max(streak, 0) + 1; ; next++) {
    const tier = streakCrate(next, rule);
    if (tier !== null) {
      return { deliveries: next - streak, tier };
    }
  }
}
