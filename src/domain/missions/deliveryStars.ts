import type { Fraction } from '../../data/units';

/**
 * A delivery's stars, as the result celebrates them: one for delivering, one
 * for being on time, one for flawless cargo. Three make a perfect delivery,
 * which keeps the perfect streak going (CrateService) and counts toward the
 * goals (AchievementService).
 */
export interface DeliveryStars {
  readonly onTime: boolean;
  readonly flawless: boolean;
  /** 1 to 3. */
  readonly count: number;
}

/** Cargo damaged less than this is flawless: it reads 100% on the result. */
export const FLAWLESS_CARGO_DAMAGE = 0.005;

export function deliveryStars(onTime: boolean, cargoDamage: Fraction): DeliveryStars {
  const flawless = cargoDamage < FLAWLESS_CARGO_DAMAGE;
  return { onTime, flawless, count: 1 + (onTime ? 1 : 0) + (flawless ? 1 : 0) };
}

export function isPerfectDelivery(stars: DeliveryStars): boolean {
  return stars.count === 3;
}
