/**
 * What crates give besides credits and looks (SupplyService), kept until
 * the player uses them:
 *
 * - pay_boost: the next few deliveries pay more (GameConfig.crates.boosters).
 * - xp_boost: the next few deliveries bring twice the experience.
 * - free_refuel: one full tank at a pump, free.
 * - free_repair: one repair at a workshop, free.
 *
 * Ids are written into save files: never rename one.
 */
export const BOOSTER_KINDS = ['pay_boost', 'xp_boost', 'free_refuel', 'free_repair'] as const;
export type BoosterKind = (typeof BOOSTER_KINDS)[number];

export function isBoosterKind(value: unknown): value is BoosterKind {
  return typeof value === 'string' && (BOOSTER_KINDS as readonly string[]).includes(value);
}
