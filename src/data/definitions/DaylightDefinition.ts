import type { Validator } from '../../core/validation/Validator';
import type { Fraction } from '../units';
import { validateWeatherLook, type WeatherLook } from './WeatherDefinition';

/**
 * The times of day that look their own (spec §39: morning, evening, night):
 * dawn with the sun just up, dusk with it going down, and the night. The day
 * itself looks like the weather (the clear weather's look is a clear day's).
 */
export const DAYLIGHT_PHASES = ['dawn', 'dusk', 'night'] as const;
export type DaylightPhase = (typeof DAYLIGHT_PHASES)[number];

export function isDaylightPhase(value: unknown): value is DaylightPhase {
  return (DAYLIGHT_PHASES as readonly unknown[]).includes(value);
}

/**
 * How a time of day looks under a clear sky. The sky passes from the day's
 * look to dawn's (or dusk's) and on to the night's as the sun goes down (or
 * back as it comes up), each look exactly so at its sun elevation; the
 * weather's own look is laid over it. The light's levels, colours and grade
 * are a clear sky's at that time; `sunlight` is the sun's (at night, the
 * moon's at its brightest).
 */
export interface DaylightDefinition {
  /** Stable snake_case id: one of DAYLIGHT_PHASES. */
  readonly id: DaylightPhase;
  /** The sun's elevation, degrees above the horizon (negative below it), where the sky looks exactly like `look`. */
  readonly sunElevationDegrees: number;
  /** Traffic drives at this share of its usual speed (fewer drivers, slower, in the dark). */
  readonly trafficSpeedFactor: Fraction;
  readonly look: WeatherLook;
}

export function validateDaylightDefinition(daylight: DaylightDefinition, path: string, validator: Validator): void {
  validator.check(isDaylightPhase(daylight.id), `${path}.id`, `must be one of ${DAYLIGHT_PHASES.join(', ')}`);
  validator.check(
    Number.isFinite(daylight.sunElevationDegrees) &&
      daylight.sunElevationDegrees >= -18 &&
      daylight.sunElevationDegrees <= 20,
    `${path}.sunElevationDegrees`,
    'must be from -18 to 20',
  );
  validator.check(
    Number.isFinite(daylight.trafficSpeedFactor) && daylight.trafficSpeedFactor >= 0.5 && daylight.trafficSpeedFactor <= 1,
    `${path}.trafficSpeedFactor`,
    'must be from 0.5 to 1',
  );
  validateWeatherLook(daylight.look, `${path}.look`, validator);
}
