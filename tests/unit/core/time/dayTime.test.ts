import { describe, expect, it } from 'vitest';
import { formatClock, MINUTES_PER_DAY, parseClock, wrapMinutes } from '../../../../src/core/time/dayTime';

describe('dayTime', () => {
  it('brings any minutes into one day', () => {
    expect(wrapMinutes(0)).toBe(0);
    expect(wrapMinutes(MINUTES_PER_DAY + 90)).toBe(90);
    expect(wrapMinutes(-30)).toBe(MINUTES_PER_DAY - 30);
  });

  it('shows a time as a 24-hour clock does, rounded down to the minute', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(7 * 60 + 5.9)).toBe('07:05');
    expect(formatClock(23 * 60 + 59)).toBe('23:59');
    expect(formatClock(MINUTES_PER_DAY + 61)).toBe('01:01');
  });

  it('reads a 24-hour time, and nothing else', () => {
    expect(parseClock('19:30')).toBe(19 * 60 + 30);
    expect(parseClock(' 7:05 ')).toBe(7 * 60 + 5);
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('12:60')).toBeNull();
    expect(parseClock('noon')).toBeNull();
    expect(parseClock('')).toBeNull();
  });
});
