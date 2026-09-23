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
