import { utcMidnightMs, type EventSchedule } from '../../data/definitions/EventDefinition';

export const DAY_MS = 24 * 60 * 60 * 1000;

/** One run of an event. */
export interface EventRun {
  /** Which run it is: 0 for the first. Progress belongs to a run. */
  readonly edition: number;
  /** When it starts and ends, epoch ms (UTC); the end is exclusive. */
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * The run of an event going on at `nowMs`, or else the next one to come;
 * null when a one-off event is over. Allocates the result.
 */
export function eventRunAt(schedule: EventSchedule, nowMs: number): EventRun | null {
  const firstStartMs = utcMidnightMs(schedule.startDate);
  const durationMs = schedule.durationDays * DAY_MS;
  const repeatMs = schedule.repeatEveryDays === undefined ? Number.POSITIVE_INFINITY : schedule.repeatEveryDays * DAY_MS;
  if (!Number.isFinite(firstStartMs) || nowMs < firstStartMs) {
    return run(0, firstStartMs, durationMs);
  }
  if (!Number.isFinite(repeatMs)) {
    return nowMs < firstStartMs + durationMs ? run(0, firstStartMs, durationMs) : null;
  }
  const edition = Math.floor((nowMs - firstStartMs) / repeatMs);
  const startMs = firstStartMs + edition * repeatMs;
  // Between runs, the next one is the one to show.
  return nowMs < startMs + durationMs ? run(edition, startMs, durationMs) : run(edition + 1, startMs + repeatMs, durationMs);
}

/** Whether `run` is going on at `nowMs`. */
export function isRunning(run: EventRun | null, nowMs: number): run is EventRun {
  return run !== null && run.startMs <= nowMs && nowMs < run.endMs;
}

function run(edition: number, startMs: number, durationMs: number): EventRun {
  return { edition, startMs, endMs: startMs + durationMs };
}
