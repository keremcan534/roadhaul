/** A crate's tier: the better, the more it holds. */
export const CRATE_TIERS = ['bronze', 'silver', 'gold'] as const;
export type CrateTier = (typeof CRATE_TIERS)[number];

export function isCrateTier(value: unknown): value is CrateTier {
  return typeof value === 'string' && (CRATE_TIERS as readonly string[]).includes(value);
}
