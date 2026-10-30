import type { Credits, Fraction } from '../../data/units';

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** The daily reward's progress, as the save keeps it. */
export interface DailyStreak {
  /** The day the reward was last claimed (localDay), or null if never. */
  readonly lastClaimDay: number | null;
  /** Days in a row claimed so far, the last claim's included; 0 if never. */
  readonly streak: number;
}

export const NO_STREAK: DailyStreak = Object.freeze({ lastClaimDay: null, streak: 0 });

/** The days since 1 January 1970 on the player's own calendar: a new one starts at their midnight. */
export function localDay(nowMs: number, offsetMinutes: number): number {
  return Math.floor((nowMs + offsetMinutes * MINUTE_MS) / DAY_MS);
}

/** Today's reward, as offered. */
export interface DailyOffer {
  /** It can be claimed now: not claimed today. */
  readonly claimable: boolean;
  /** The streak's day it is (or was, once claimed), 1 for the first; it starts over after the last. */
  readonly day: number;
  /** Days in a row with today's claim, from 1. */
  readonly streak: number;
}

/**
 * Today's reward: the next day of the streak when the last claim was yesterday, day 1 again when a day was missed (or
 * never claimed). Claimed today, it is not offered again; nor when the calendar went back (a phone's date set back
 * after a claim), until the day after the last claim comes round again.
 */
export function dailyOffer(state: DailyStreak, today: number, days: number): DailyOffer {
  const last = state.lastClaimDay;
  if (last !== null && today <= last) {
    return { claimable: false, day: dayOfStreak(state.streak, days), streak: state.streak };
  }
  const streak = last !== null && today === last + 1 ? state.streak + 1 : 1;
  return { claimable: true, day: dayOfStreak(streak, days), streak };
}

/** The streak after claiming today's reward (`offer` from dailyOffer, claimable). */
export function claimDaily(offer: DailyOffer, today: number): DailyStreak {
  return { lastClaimDay: today, streak: offer.streak };
}

/** What day `day` (from 1) of the streak pays a company at `companyLevel`. */
export function dailyCredits(table: readonly Credits[], day: number, companyLevel: number, levelBonus: Fraction): Credits {
  const base = table[Math.min(Math.max(day, 1), table.length) - 1] ?? 0;
  return Math.round((base * (1 + levelBonus * Math.max(companyLevel - 1, 0))) / 10) * 10;
}

function dayOfStreak(streak: number, days: number): number {
  return streak <= 0 ? 1 : ((streak - 1) % days) + 1;
}
