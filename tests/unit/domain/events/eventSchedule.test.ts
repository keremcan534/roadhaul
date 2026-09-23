import { describe, expect, it } from 'vitest';
import { DAY_MS, eventRunAt, isRunning } from '../../../../src/domain/events/eventSchedule';

/** A week on, a week off, from Monday 2026-01-05. */
const FORTNIGHTLY = { startDate: '2026-01-05', durationDays: 7, repeatEveryDays: 14 };
const FIRST_START = Date.UTC(2026, 0, 5);

describe('eventRunAt', () => {
  it('shows the first run before the event has ever started', () => {
    const now = FIRST_START - 3 * DAY_MS;

    const run = eventRunAt(FORTNIGHTLY, now);

    expect(run).toEqual({ edition: 0, startMs: FIRST_START, endMs: FIRST_START + 7 * DAY_MS });
    expect(isRunning(run, now)).toBe(false);
  });

  it('finds the run going on, however many runs ago the event began', () => {
    // 2026-09-28 is 266 days (19 fortnights) after the first start: the 20th run begins.
    const start = Date.UTC(2026, 8, 28);
    for (const now of [start, start + 3.5 * DAY_MS, start + 7 * DAY_MS - 1]) {
      const run = eventRunAt(FORTNIGHTLY, now);
      expect(run).toEqual({ edition: 19, startMs: start, endMs: start + 7 * DAY_MS });
      expect(isRunning(run, now)).toBe(true);
    }
  });

  it('shows the next run between two runs', () => {
    const now = Date.UTC(2026, 8, 23, 15); // A Wednesday in an off week.

    const run = eventRunAt(FORTNIGHTLY, now);

    expect(run).toEqual({ edition: 19, startMs: Date.UTC(2026, 8, 28), endMs: Date.UTC(2026, 9, 5) });
    expect(isRunning(run, now)).toBe(false);
  });

  it('runs a one-off event once, then never again', () => {
    const once = { startDate: '2026-03-01', durationDays: 3 };
    const start = Date.UTC(2026, 2, 1);

    expect(isRunning(eventRunAt(once, start + DAY_MS), start + DAY_MS)).toBe(true);
    expect(eventRunAt(once, start + 3 * DAY_MS)).toBeNull();
    expect(isRunning(null, start)).toBe(false);
  });

  it('keeps one run going for as long as it lasts when runs follow each other with no gap', () => {
    const weekly = { startDate: '2026-01-05', durationDays: 7, repeatEveryDays: 7 };

    const late = eventRunAt(weekly, FIRST_START + 7 * DAY_MS - 1);
    const next = eventRunAt(weekly, FIRST_START + 7 * DAY_MS);

    expect(late!.edition).toBe(0);
    expect(next!.edition).toBe(1);
    expect(isRunning(next, FIRST_START + 7 * DAY_MS)).toBe(true);
  });
});
