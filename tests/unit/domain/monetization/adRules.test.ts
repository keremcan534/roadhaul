import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import {
  FRESH_PACING,
  allowanceLeft,
  allowanceUsed,
  dayOf,
  deliveryBonus,
  interstitialDue,
  pacingAfterAd,
  pacingAfterDelivery,
  parseAllowance,
  parsePacing,
  type AdPacing,
} from '../../../../src/domain/monetization/adRules';

const config = {
  ...DEFAULT_GAME_CONFIG.monetization,
  deliveryBonusShare: 0.25,
  deliveryBonusMinCredits: 100,
  deliveryBonusMaxCredits: 2500,
  interstitialFirstAfterDeliveries: 3,
  interstitialEveryDeliveries: 3,
  interstitialMinSeconds: 480,
};

const deliveries = (count: number, from: AdPacing = FRESH_PACING): AdPacing => {
  let pacing = from;
  for (let i = 0; i < count; i++) {
    pacing = pacingAfterDelivery(pacing);
  }
  return pacing;
};

describe('deliveryBonus', () => {
  it("pays a quarter of the delivery's total, within the floor and the ceiling", () => {
    expect(deliveryBonus(1260, config)).toBe(315);
    expect(deliveryBonus(200, config)).toBe(100);
    expect(deliveryBonus(40_000, config)).toBe(2500);
  });

  it('pays nothing for a delivery that paid nothing', () => {
    expect(deliveryBonus(0, config)).toBe(0);
    expect(deliveryBonus(Number.NaN, config)).toBe(0);
  });
});

describe('interstitials', () => {
  const now = 1_000_000_000;

  it('come only after the first few deliveries of a game', () => {
    expect(interstitialDue(deliveries(2), now, config)).toBe(false);
    expect(interstitialDue(deliveries(3), now, config)).toBe(true);
  });

  it('then after every few deliveries, never two in a row', () => {
    const shown = pacingAfterAd(deliveries(3), 'interstitial', now);
    const later = now + 3600_000;
    expect(interstitialDue(deliveries(1, shown), later, config)).toBe(false);
    expect(interstitialDue(deliveries(2, shown), later, config)).toBe(false);
    expect(interstitialDue(deliveries(3, shown), later, config)).toBe(true);
  });

  it('wait a while after any ad, a rewarded one too', () => {
    const rewarded = pacingAfterAd(deliveries(3), 'rewarded', now);
    expect(rewarded.sinceInterstitial).toBe(3);
    expect(interstitialDue(rewarded, now + 479_000, config)).toBe(false);
    expect(interstitialDue(rewarded, now + 480_000, config)).toBe(true);
  });

  it('read back only well-formed stored pacing', () => {
    expect(parsePacing({ deliveries: 7, sinceInterstitial: 1, lastAdAtMs: now - 60_000 }, now)).toEqual({
      deliveries: 7,
      sinceInterstitial: 1,
      lastAdAtMs: now - 60_000,
    });
    expect(parsePacing({ deliveries: 2, sinceInterstitial: 2, lastAdAtMs: null }, now)).toEqual(deliveries(2));
    expect(parsePacing({ deliveries: -1, sinceInterstitial: 0, lastAdAtMs: null }, now)).toBeNull();
    expect(parsePacing({ deliveries: 1.5, sinceInterstitial: 0, lastAdAtMs: null }, now)).toBeNull();
    expect(parsePacing({ deliveries: 3, sinceInterstitial: 0 }, now)).toBeNull();
    expect(parsePacing({ deliveries: 3, sinceInterstitial: 0, lastAdAtMs: 'yesterday' }, now)).toBeNull();
    expect(parsePacing(null, now)).toBeNull();
    expect(parsePacing([3, 0, null], now)).toBeNull();
  });

  it('forget a last ad later than now: a clock set back does not hold them off', () => {
    const stored = parsePacing({ deliveries: 9, sinceInterstitial: 4, lastAdAtMs: now + 86_400_000 }, now);
    expect(stored).toEqual({ deliveries: 9, sinceInterstitial: 4, lastAdAtMs: null });
    expect(interstitialDue(stored!, now, config)).toBe(true);
  });
});

describe('the daily allowance', () => {
  const noon = Date.parse('2026-09-30T12:00:00Z');

  it('counts the uses of the day, and starts again the next', () => {
    let allowance = null;
    expect(allowanceLeft(allowance, noon, 5)).toBe(5);
    allowance = allowanceUsed(allowance, noon);
    allowance = allowanceUsed(allowance, noon + 1000);
    expect(allowanceLeft(allowance, noon, 5)).toBe(3);
    expect(allowanceLeft(allowance, Date.parse('2026-10-01T00:00:01Z'), 5)).toBe(5);
    expect(allowanceUsed(allowance, Date.parse('2026-10-01T09:00:00Z'))).toEqual({ day: dayOf(noon) + 1, used: 1 });
  });

  it('never goes below none left', () => {
    expect(allowanceLeft({ day: dayOf(noon), used: 9 }, noon, 5)).toBe(0);
  });

  it('reads back only a well-formed stored allowance', () => {
    expect(parseAllowance({ day: 20361, used: 2 })).toEqual({ day: 20361, used: 2 });
    expect(parseAllowance({ day: 20361, used: -1 })).toBeNull();
    expect(parseAllowance({ day: '20361', used: 2 })).toBeNull();
    expect(parseAllowance(null)).toBeNull();
    expect(parseAllowance('nope')).toBeNull();
  });
});
