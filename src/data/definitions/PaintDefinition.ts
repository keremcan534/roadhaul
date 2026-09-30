import type { Validator } from '../../core/validation/Validator';
import type { Credits } from '../units';

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
  if (paint.premium === true) {
    validator.check(paint.price === 0, `${path}.price`, 'must be 0 for a premium colour: the purchase pays for it');
  } else {
    validator.positiveInteger(paint.price, `${path}.price`);
  }
  if (paint.requiredCompanyLevel !== undefined) {
    validator.positiveInteger(paint.requiredCompanyLevel, `${path}.requiredCompanyLevel`);
  }
}
