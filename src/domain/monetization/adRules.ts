import type { GameConfig } from '../../data/config/GameConfig';
import type { Credits } from '../../data/units';

type MonetizationConfig = GameConfig['monetization'];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The bonus a rewarded ad adds to a delivery's pay: a share of its total, within the configured floor and ceiling.
 * Nothing for a delivery that paid nothing.
 */
export function deliveryBonus(total: Credits, config: MonetizationConfig): Credits {
  if (!(total > 0)) {
    return 0;
  }
  const bonus = Math.round(total * config.deliveryBonusShare);
  return Math.min(config.deliveryBonusMaxCredits, Math.max(config.deliveryBonusMinCredits, bonus));
}

/** How often ads have come lately: what the interstitials' pacing needs. Session-long, not saved. */
export interface AdPacing {
  /** Deliveries since the game started. */
  readonly deliveries: number;
  /** Deliveries since the last interstitial. */
  readonly sinceInterstitial: number;
  /** When the last full-screen ad (either kind) closed, epoch ms; null before the first. */
  readonly lastAdAtMs: number | null;
}

export const FRESH_PACING: AdPacing = Object.freeze({ deliveries: 0, sinceInterstitial: 0, lastAdAtMs: null });

export function pacingAfterDelivery(pacing: AdPacing): AdPacing {
  return { ...pacing, deliveries: pacing.deliveries + 1, sinceInterstitial: pacing.sinceInterstitial + 1 };
}

/** After an ad closed at `nowMs`: an interstitial starts the count of deliveries over; any ad restarts the wait. */
export function pacingAfterAd(pacing: AdPacing, kind: 'interstitial' | 'rewarded', nowMs: number): AdPacing {
  return {
    ...pacing,
    sinceInterstitial: kind === 'interstitial' ? 0 : pacing.sinceInterstitial,
    lastAdAtMs: nowMs,
  };
}

/**
 * Whether an interstitial may show now, between contracts: never in the first deliveries of a game, then after every
 * few, and never soon after another ad.
 */
export function interstitialDue(pacing: AdPacing, nowMs: number, config: MonetizationConfig): boolean {
  return (
    pacing.deliveries >= config.interstitialFirstAfterDeliveries &&
    pacing.sinceInterstitial >= config.interstitialEveryDeliveries &&
    (pacing.lastAdAtMs === null || nowMs - pacing.lastAdAtMs >= config.interstitialMinSeconds * 1000)
  );
}

/** Uses of a daily allowance (the rewarded service discounts): which day, and how many so far that day. */
export interface DailyAllowance {
  /** Days since 1970-01-01 (UTC): the allowance starts again at midnight UTC. */
  readonly day: number;
  readonly used: number;
}

export function dayOf(epochMs: number): number {
  return Math.floor(epochMs / MS_PER_DAY);
}

/** How many uses are left today, of `perDay`. */
export function allowanceLeft(allowance: DailyAllowance | null, nowMs: number, perDay: number): number {
  const used = allowance !== null && allowance.day === dayOf(nowMs) ? allowance.used : 0;
  return Math.max(0, perDay - used);
}

/** The allowance after one more use at `nowMs`. */
export function allowanceUsed(allowance: DailyAllowance | null, nowMs: number): DailyAllowance {
  const day = dayOf(nowMs);
  return { day, used: allowance !== null && allowance.day === day ? allowance.used + 1 : 1 };
}

/** A stored allowance read back, or null when it is missing or not an allowance. */
export function parseAllowance(value: unknown): DailyAllowance | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { day, used } = value as Record<string, unknown>;
  return Number.isInteger(day) && Number.isInteger(used) && (used as number) >= 0
    ? { day: day as number, used: used as number }
    : null;
}
