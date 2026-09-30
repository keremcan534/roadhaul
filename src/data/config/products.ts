/**
 * What the game sells on Google Play (spec §35): comfort and looks, never progress. Each id names its product in the
 * Play Console (docs/RELEASE.md), and is kept on the phone once bought: never rename one.
 *
 * - `remove_ads`: no ads between contracts, and the rewarded boosts without watching an ad.
 * - `premium_paints`: the garage's premium colours (PaintDefinition.premium).
 */
export const PRODUCT_IDS = ['remove_ads', 'premium_paints'] as const;
export type ProductId = (typeof PRODUCT_IDS)[number];

export function isProductId(value: unknown): value is ProductId {
  return typeof value === 'string' && (PRODUCT_IDS as readonly string[]).includes(value);
}
