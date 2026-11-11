import { describe, expect, it } from 'vitest';
import { afterAsk, afterDelivery, NO_REVIEW_HISTORY, parseReviewHistory, reviewDue } from '../../../../src/domain/review/reviewRules';

const RULES = { firstAfterDeliveries: 3, maxCargoDamage: 0.1, daysBetween: 60, maxAsks: 2 };
const DAY_MS = 86_400_000;

describe('review rules', () => {
  it('counts only deliveries that arrived in good order', () => {
    let history = NO_REVIEW_HISTORY;
    history = afterDelivery(history, 0, RULES);
    history = afterDelivery(history, 0.1, RULES);
    history = afterDelivery(history, 0.4, RULES);
    expect(history.goodDeliveries).toBe(2);
  });

  it('asks after enough good deliveries, then not again for a while, and only a few times ever', () => {
    const ready = { ...NO_REVIEW_HISTORY, goodDeliveries: 3 };
    expect(reviewDue({ ...ready, goodDeliveries: 2 }, 0, RULES)).toBe(false);
    expect(reviewDue(ready, 0, RULES)).toBe(true);

    const asked = afterAsk(ready, 1000);
    expect(asked).toEqual({ goodDeliveries: 0, lastAskedMs: 1000, asks: 1 });
    const readyAgain = { ...asked, goodDeliveries: 3 };
    expect(reviewDue(readyAgain, 1000 + 59 * DAY_MS, RULES)).toBe(false);
    expect(reviewDue(readyAgain, 1000 + 60 * DAY_MS, RULES)).toBe(true);
    expect(reviewDue({ ...readyAgain, asks: 2 }, 1000 + 600 * DAY_MS, RULES)).toBe(false);
  });

  it('reads back what it can of a stored history', () => {
    expect(parseReviewHistory({ goodDeliveries: 4, lastAskedMs: 5, asks: 1 })).toEqual({ goodDeliveries: 4, lastAskedMs: 5, asks: 1 });
    expect(parseReviewHistory({ goodDeliveries: -1, lastAskedMs: 'x', asks: 1.5 })).toEqual(NO_REVIEW_HISTORY);
    expect(parseReviewHistory('nonsense')).toEqual(NO_REVIEW_HISTORY);
  });
});
