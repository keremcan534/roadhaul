import type { Validator } from '../../core/validation/Validator';
import type { Credits } from '../units';

/** How rare a colour that only crates hold is: the rarer, the less often a crate gives it (GameConfig.crates). */
export const PAINT_RARITIES = ['rare', 'epic', 'legendary'] as const;
export type PaintRarity = (typeof PAINT_RARITIES)[number];

export function isPaintRarity(value: unknown): value is PaintRarity {
  return typeof value === 'string' && (PAINT_RARITIES as readonly string[]).includes(value);
}

/**
 * A colour the garage paints a truck in: the cab, and the stripe and doors
 * of its livery (player feedback: customisation; the spec leaves cosmetics
 * for later, §25 and §71: here they are bought with credits earned). Every
 * truck leaves the dealer in its model's factory colour, which the garage
 * brings back for free. Player-facing names come from the string tables
 * (`paint.<id>.name`).
 */
export interface PaintDefinition {
  /** Stable snake_case id. It is written into save files: never rename it. */
  readonly id: string;
  /** 0xRRGGBB. */
  readonly color: number;
  /** Credits for each truck painted in it: 0 for a premium colour, which the purchase pays for. */
  readonly price: Credits;
  /** The company level that lets the garage use it (spec §14). Omit for level 1. */
  readonly requiredCompanyLevel?: number;
  /**
   * One of the premium colours: they come with the "Premium paints" purchase (data/config/products.ts), and the
   * garage shows them only where it is sold.
   */
  readonly premium?: boolean;
  /**
   * One of the colours only crates hold (CrateService), this rare: never sold, for credits or money; the garage
   * shows it locked until a crate has given it, then paints it for free.
   */
  readonly crate?: PaintRarity;
}

export function validatePaintDefinition(paint: PaintDefinition, path: string, validator: Validator): void {
  validator.id(paint.id, `${path}.id`);
  validator.check(
    Number.isInteger(paint.color) && paint.color >= 0 && paint.color <= 0xffffff,
    `${path}.color`,
    'must be a colour, 0x000000 to 0xffffff',
  );
  if (paint.premium !== undefined) {
    validator.boolean(paint.premium, `${path}.premium`);
  }
  if (paint.crate !== undefined) {
    validator.check(isPaintRarity(paint.crate), `${path}.crate`, `unknown rarity "${String(paint.crate)}"`);
    validator.check(paint.premium !== true, `${path}.premium`, 'a crate colour is never a premium one');
  }
  if (paint.premium === true || paint.crate !== undefined) {
    validator.check(paint.price === 0, `${path}.price`, 'must be 0 for a premium or crate colour: never sold for credits');
  } else {
    validator.positiveInteger(paint.price, `${path}.price`);
  }
  if (paint.requiredCompanyLevel !== undefined) {
    validator.positiveInteger(paint.requiredCompanyLevel, `${path}.requiredCompanyLevel`);
  }
}
