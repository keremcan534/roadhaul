import type { Season } from '../../data/definitions/Season';
import { dayOfYear } from '../sky/solar';

/**
 * The meteorological seasons of the northern hemisphere, by day of the year
 * (0 on 1 January): spring from 1 March, summer from 1 June, autumn from
 * 1 September and winter from 1 December (in a year that is not a leap
 * year; close enough).
 */
const SPRING_FROM_DAY = 59;
const SUMMER_FROM_DAY = 151;
const AUTUMN_FROM_DAY = 243;
const WINTER_FROM_DAY = 334;

/** The season on the calendar at `epochMs` (UTC). Allocation-free. */
export function seasonOf(epochMs: number): Season {
  const day = dayOfYear(epochMs);
  if (day < SPRING_FROM_DAY || day >= WINTER_FROM_DAY) {
    return 'winter';
  }
  if (day < SUMMER_FROM_DAY) {
    return 'spring';
  }
  return day < AUTUMN_FROM_DAY ? 'summer' : 'autumn';
}
