import { describe, expect, it } from 'vitest';
import { claimDaily, dailyCredits, dailyOffer, localDay, NO_STREAK } from '../../../../src/domain/rewards/dailyReward';

const DAY_MS = 86_400_000;
const TABLE = [300, 500, 800, 1200, 1600, 2200, 4000];

describe('localDay', () => {
  it('starts a new day at the player’s own midnight', () => {
    const midnightUtc = 20_000 * DAY_MS;
    expect(localDay(midnightUtc - 1, 0)).toBe(19_999);
    expect(localDay(midnightUtc, 0)).toBe(20_000);
    // Istanbul (UTC+3): midnight comes three hours before it does in UTC.
    expect(localDay(midnightUtc - 3 * 3_600_000, 180)).toBe(20_000);
    expect(localDay(midnightUtc - 3 * 3_600_000 - 1, 180)).toBe(19_999);
    // New York in winter (UTC−5): five hours after.
    expect(localDay(midnightUtc + 5 * 3_600_000 - 1, -300)).toBe(19_999);
  });
});

describe('dailyOffer', () => {
  it('offers day 1 to a company that never claimed', () => {
    expect(dailyOffer(NO_STREAK, 100, 7)).toEqual({ claimable: true, day: 1, streak: 1 });
  });

  it('offers the next day of the streak the day after a claim, and nothing more the same day', () => {
    const first = claimDaily(dailyOffer(NO_STREAK, 100, 7), 100);
    expect(dailyOffer(first, 100, 7)).toEqual({ claimable: false, day: 1, streak: 1 });
    expect(dailyOffer(first, 101, 7)).toEqual({ claimable: true, day: 2, streak: 2 });
  });

  it('starts the streak again after a day missed', () => {
    expect(dailyOffer({ lastClaimDay: 100, streak: 5 }, 102, 7)).toEqual({ claimable: true, day: 1, streak: 1 });
  });

  it('goes round again after the last day, the streak still counting', () => {
    expect(dailyOffer({ lastClaimDay: 100, streak: 7 }, 101, 7)).toEqual({ claimable: true, day: 1, streak: 8 });
    expect(dailyOffer({ lastClaimDay: 100, streak: 13 }, 101, 7)).toEqual({ claimable: true, day: 7, streak: 14 });
  });

  it('offers nothing when the calendar went back past the last claim', () => {
    expect(dailyOffer({ lastClaimDay: 100, streak: 3 }, 95, 7)).toEqual({ claimable: false, day: 3, streak: 3 });
  });
});

describe('dailyCredits', () => {
  it('pays each day of the table at level 1, more at each level above, in tens', () => {
    expect(TABLE.map((_, index) => dailyCredits(TABLE, index + 1, 1, 0.5, 4))).toEqual(TABLE);
    expect(dailyCredits(TABLE, 1, 2, 0.5, 4)).toBe(450);
    expect(dailyCredits(TABLE, 7, 5, 0.5, 4)).toBe(12_000);
    // Levels above the bonus levels add nothing more.
    expect(dailyCredits(TABLE, 7, 9, 0.5, 4)).toBe(12_000);
    expect(dailyCredits([333], 1, 2, 0.25, 4)).toBe(420);
  });

  it('keeps a day outside the table to its ends', () => {
    expect(dailyCredits(TABLE, 0, 1, 0.5, 4)).toBe(300);
    expect(dailyCredits(TABLE, 9, 1, 0.5, 4)).toBe(4000);
  });
});
