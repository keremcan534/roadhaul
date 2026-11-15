import type { Credits } from '../../data/units';

const MS_PER_HOUR = 3_600_000;

/**
 * The rent piling up at the warehouse (RentService): credits waiting, kept
 * to the fraction so none is lost between looks, and the time from which it
 * has grown at the rate the warehouse had then.
 */
export interface RentState {
  readonly storedCredits: number;
  readonly sinceMs: number;
}

/**
 * The rent waiting at `nowMs`: what was stored, and `ratePerHour` since
 * `sinceMs`, up to `capHours` of it. The clock going back (a phone's time
 * set earlier) adds nothing, and takes nothing away.
 */
export function accruedRent(state: RentState, ratePerHour: Credits, nowMs: number, capHours: number): number {
  const cap = Math.max(0, ratePerHour) * capHours;
  const grown = ratePerHour > 0 ? (ratePerHour * Math.max(0, nowMs - state.sinceMs)) / MS_PER_HOUR : 0;
  return Math.min(Math.max(cap, state.storedCredits), state.storedCredits + grown);
}

/** How full the warehouse's rent is, 0..1: what waits over the most that may pile up (0 without a warehouse). */
export function rentFullness(waiting: number, ratePerHour: Credits, capHours: number): number {
  const cap = ratePerHour * capHours;
  return cap > 0 ? Math.min(1, Math.max(0, waiting / cap)) : 0;
}
