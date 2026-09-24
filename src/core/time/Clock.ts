/**
 * Wall-clock time as Unix epoch milliseconds (UTC). Inject a Clock instead of
 * calling `Date.now()` so time-dependent rules (save timestamps, event windows)
 * stay testable.
 */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = Object.freeze({
  now: () => Date.now(),
});

/** `base`'s time moved by `offsetMs`: another date on the calendar, still ticking. */
export function shiftedClock(base: Clock, offsetMs: number): Clock {
  return Object.freeze({ now: () => base.now() + offsetMs });
}
