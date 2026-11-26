import type { Validator } from '../../core/validation/Validator';
import { isProductId, type ProductId } from '../config/products';
import type { Credits } from '../units';
import { isPaintRarity, type PaintRarity } from './PaintDefinition';

/**
 * The designs a truck's body can wear (the presentation draws each:
 * liveryImages' liveryImage), in the truck's own colour with the
 * company's trailer text: the RoadHaul classic every truck leaves the
 * dealer in, stripes and checks, flames and tigers, neon and galaxies,
 * carbon and rally, the northern lights and an eclipse.
 */
export const LIVERY_PATTERNS = [
  'classic',
  'speed',
  'chevrons',
  'checker',
  'waves',
  'sunset',
  'hexagon',
  'stars',
  'camo',
  'lightning',
  'galaxy',
  'flames',
  'tiger',
  'splatter',
  'neon',
  'circuit',
  'synthwave',
  'carbon',
  'rally',
  'pixel',
  'tribal',
  'aurora',
  'eclipse',
] as const;
export type LiveryPattern = (typeof LIVERY_PATTERNS)[number];

/**
 * A design for the trucks (LiveryService), got one way: free (the classic),
 * bought once with credits from a company level (`price`, then free on
 * every truck), given by a crate (`crate`, its rarity), or with a cosmetic
 * pack bought in the shop (`pack`). A pack's design may also be earned by
 * playing (`earnedBy`, an achievement: reached, the design is the company's
 * without the pack): the shop sells the way round the goal, never progress.
 * Player-facing names come from the string tables (`livery.<id>.name`).
 */
export interface LiveryDefinition {
  /** Stable snake_case id. It is written into save files: never rename it. */
  readonly id: string;
  readonly pattern: LiveryPattern;
  /** Credits, once, for the company; 0 for the classic, a crate's or a pack's. */
  readonly price: Credits;
  /** The company level that lets the garage sell it. Omit for level 1. */
  readonly requiredCompanyLevel?: number;
  readonly crate?: PaintRarity;
  readonly pack?: ProductId;
  /** A pack's design only: the achievement (AchievementDefinition id) that earns it without the pack. */
  readonly earnedBy?: string;
}

export function validateLiveryDefinition(livery: LiveryDefinition, path: string, validator: Validator): void {
  validator.id(livery.id, `${path}.id`);
  validator.oneOf(livery.pattern, LIVERY_PATTERNS, `${path}.pattern`);
  validator.nonNegativeInteger(livery.price, `${path}.price`);
  if (livery.crate !== undefined) {
    validator.check(isPaintRarity(livery.crate), `${path}.crate`, `unknown rarity "${String(livery.crate)}"`);
  }
  if (livery.pack !== undefined) {
    validator.check(isProductId(livery.pack), `${path}.pack`, `unknown product "${String(livery.pack)}"`);
  }
  if (livery.requiredCompanyLevel !== undefined) {
    validator.positiveInteger(livery.requiredCompanyLevel, `${path}.requiredCompanyLevel`);
  }
  const ways = [livery.price > 0, livery.crate !== undefined, livery.pack !== undefined].filter(Boolean).length;
  validator.check(ways <= 1, path, 'must come one way only: credits, a crate or a pack');
  if (livery.earnedBy !== undefined) {
    validator.id(livery.earnedBy, `${path}.earnedBy`);
    validator.check(livery.pack !== undefined, `${path}.earnedBy`, 'only a pack design is also earned by playing');
  }
}
