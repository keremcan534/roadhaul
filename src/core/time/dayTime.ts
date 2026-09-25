/** Minutes in a day: a time of day is minutes after midnight, from 0 to under this. */
export const MINUTES_PER_DAY = 24 * 60;

/** `minutes` after midnight brought into 0..MINUTES_PER_DAY, whatever day it falls on. */
export function wrapMinutes(minutes: number): number {
  const wrapped = minutes % MINUTES_PER_DAY;
  return wrapped < 0 ? wrapped + MINUTES_PER_DAY : wrapped;
}

/** A time of day as a 24-hour clock shows it, rounded down to the minute: "07:05". */
export function formatClock(minutes: number): string {
  const whole = Math.floor(wrapMinutes(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${hours < 10 ? '0' : ''}${hours}:${rest < 10 ? '0' : ''}${rest}`;
}

/** "7:05" or "07:05" (24-hour, "24:00" not included) as minutes after midnight, or null when it is not a time. */
export function parseClock(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (match === null) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}
