import type { GameConfig } from '../../data/config/GameConfig';
import type { Fraction } from '../../data/units';

const DAY_MS = 24 * 60 * 60 * 1000;

/** When the game asks the player to rate it. */
export type ReviewRules = GameConfig['review'];

/** What the phone remembers of the asking (not in the save: it is about this player and this phone). */
export interface ReviewHistory {
  /** Deliveries in good order since the last ask (or ever). */
  readonly goodDeliveries: number;
  /** When the last ask was made, Unix ms; null if never. */
  readonly lastAskedMs: number | null;
  readonly asks: number;
}

export const NO_REVIEW_HISTORY: ReviewHistory = Object.freeze({ goodDeliveries: 0, lastAskedMs: null, asks: 0 });

/** The history after a delivery whose cargo arrived `cargoDamage` damaged: counted if it came in good order. */
export function afterDelivery(history: ReviewHistory, cargoDamage: Fraction, rules: ReviewRules): ReviewHistory {
  return cargoDamage <= rules.maxCargoDamage ? { ...history, goodDeliveries: history.goodDeliveries + 1 } : history;
}

/** Whether to ask now: enough deliveries in good order, long enough since the last ask, and not asked too often. */
export function reviewDue(history: ReviewHistory, nowMs: number, rules: ReviewRules): boolean {
  return (
    history.asks < rules.maxAsks &&
    history.goodDeliveries >= rules.firstAfterDeliveries &&
    (history.lastAskedMs === null || nowMs - history.lastAskedMs >= rules.daysBetween * DAY_MS)
  );
}

/** The history once asked at `nowMs`: the deliveries count again from nothing. */
export function afterAsk(history: ReviewHistory, nowMs: number): ReviewHistory {
  return { goodDeliveries: 0, lastAskedMs: nowMs, asks: history.asks + 1 };
}

/** A history read back from storage, or none when it cannot be. */
export function parseReviewHistory(raw: unknown): ReviewHistory {
  if (typeof raw !== 'object' || raw === null) {
    return NO_REVIEW_HISTORY;
  }
  const { goodDeliveries, lastAskedMs, asks } = raw as Record<string, unknown>;
  const count = (value: unknown): number => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0);
  return {
    goodDeliveries: count(goodDeliveries),
    lastAskedMs: typeof lastAskedMs === 'number' && Number.isFinite(lastAskedMs) ? lastAskedMs : null,
    asks: count(asks),
  };
}
