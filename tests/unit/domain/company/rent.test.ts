import { describe, expect, it } from 'vitest';
import { accruedRent, rentFullness } from '../../../../src/domain/company/rent';

const HOUR_MS = 3_600_000;

describe('rent', () => {
  it('grows at the rate an hour from when it was settled, up to the cap', () => {
    const state = { storedCredits: 100, sinceMs: 0 };
    expect(accruedRent(state, 150, 2 * HOUR_MS, 8)).toBe(400);
    expect(accruedRent(state, 150, 30 * 60_000, 8)).toBe(175);
    // Eight hours' worth at most, however long the game was closed.
    expect(accruedRent(state, 150, 100 * HOUR_MS, 8)).toBe(1200);
  });

  it('adds nothing without a warehouse, nor when the clock goes back, and keeps what was stored', () => {
    expect(accruedRent({ storedCredits: 0, sinceMs: 0 }, 0, 5 * HOUR_MS, 8)).toBe(0);
    expect(accruedRent({ storedCredits: 300, sinceMs: 10 * HOUR_MS }, 150, 2 * HOUR_MS, 8)).toBe(300);
    // More stored than a smaller warehouse's cap (a game whose content changed): kept, not grown.
    expect(accruedRent({ storedCredits: 2000, sinceMs: 0 }, 150, 5 * HOUR_MS, 8)).toBe(2000);
  });

  it('says how full it is', () => {
    expect(rentFullness(600, 150, 8)).toBe(0.5);
    expect(rentFullness(5000, 150, 8)).toBe(1);
    expect(rentFullness(10, 0, 8)).toBe(0);
  });
});
