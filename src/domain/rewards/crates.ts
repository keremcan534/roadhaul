import type { CrateTier, CrateTierConfig, GameConfig } from '../../data/config/GameConfig';
import { BOOSTER_KINDS, type BoosterKind } from '../../data/definitions/BoosterKind';
import { CRATE_TIERS } from '../../data/definitions/CrateTier';
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
  /** Upgrade parts: 0 for none. */
  readonly parts: number;
  /** A booster, or null. */
  readonly booster: BoosterKind | null;
}

/** Every draw takes this many rolls, whatever the crate holds: a crate never changes the next one's luck. */
export const CRATE_ROLLS = 8;

/**
 * What a crate of `config`'s tier holds, drawn with `random` (uniform in
 * [0, 1)): credits between its two; by its parts chance upgrade parts; by
 * its booster chance a booster, its kind by `boosterWeights`; and by its
 * paint chance a crate colour from those the company has not got yet
 * (`unowned`), its rarity by the tier's weights, then one of that rarity
 * evenly (with every colour got, none).
 */
export function drawCrate(
  config: CrateTierConfig,
  unowned: readonly CratePaint[],
  random: () => number,
  boosterWeights: Readonly<Record<BoosterKind, number>>,
): CrateContents {
  const [least, most] = config.credits;
  // In tens, as the rest of the game's rewards.
  const credits = Math.round((least + (most - least) * random()) / 10) * 10;
  const withPaint = random() < config.paintChance;
  const roll = random();
  const pick = random();
  const withParts = random() < config.partsChance;
  const partsRoll = random();
  const [fewest, mostParts] = config.parts;
  const parts = withParts ? Math.min(mostParts, fewest + Math.floor(partsRoll * (mostParts - fewest + 1))) : 0;
  const withBooster = random() < config.boosterChance;
  const boosterRoll = random();
  const booster = withBooster ? weighted(BOOSTER_KINDS, boosterWeights, boosterRoll) : null;
  return { credits, paintId: withPaint ? drawPaint(config, unowned, roll, pick) : null, parts, booster };
}

/** A crate colour of `unowned`: its rarity by the tier's weights (`roll`), then one of it evenly (`pick`). */
function drawPaint(config: CrateTierConfig, unowned: readonly CratePaint[], roll: number, pick: number): string | null {
  if (unowned.length === 0) {
    return null;
  }
  let total = 0;
  for (const rarity of PAINT_RARITIES) {
    if (unowned.some((paint) => paint.rarity === rarity)) {
      total += config.rarityWeights[rarity];
    }
  }
  if (total <= 0) {
    return null;
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
  return ofRarity[Math.min(ofRarity.length - 1, Math.floor(pick * ofRarity.length))]!.id;
}

/** One of `kinds` by `weights` against each other (`roll` uniform in [0, 1)); null when none has any weight. */
export function weighted<K extends string>(kinds: readonly K[], weights: Readonly<Record<K, number>>, roll: number): K | null {
  let total = 0;
  for (const kind of kinds) {
    total += Math.max(0, weights[kind]);
  }
  if (total <= 0) {
    return null;
  }
  let left = roll * total;
  let last: K | null = null;
  for (const kind of kinds) {
    const weight = Math.max(0, weights[kind]);
    if (weight <= 0) {
      continue;
    }
    last = kind;
    left -= weight;
    if (left < 0) {
      return kind;
    }
  }
  return last;
}

/** The free crate's tier, by its weights (`roll` uniform in [0, 1)). */
export function freeCrateTier(roll: number, weights: GameConfig['crates']['freeCrateWeights']): CrateTier {
  return weighted(CRATE_TIERS, weights, roll) ?? 'bronze';
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
