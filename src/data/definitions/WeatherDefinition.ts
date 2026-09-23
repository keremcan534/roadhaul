import type { Validator } from '../../core/validation/Validator';
import type { Fraction } from '../units';

/**
 * A kind of weather (spec §38: clear, cloudy, rain, night). It changes how
 * the truck grips and how fast traffic drives, and how the world looks.
 * Colours are 0xRRGGBB; light levels are shares of a clear day's.
 */
export interface WeatherDefinition {
  /** Stable snake_case id. */
  readonly id: string;
  /** How likely the weather turns to this next, relative to the others. */
  readonly weight: number;
  /** It lasts a random time between these, seconds. */
  readonly minSeconds: number;
  readonly maxSeconds: number;
  /** Multiplies the tyres' grip: below 1 on a wet road. */
  readonly gripFactor: number;
  /** Traffic drives at this share of its usual speed. */
  readonly trafficSpeedFactor: Fraction;
  readonly look: WeatherLook;
}

export interface WeatherLook {
  /** Sky colour overhead and at the horizon; the haze takes the horizon's. */
  readonly zenithColor: number;
  readonly horizonColor: number;
  /** Exponential fog density: higher is thicker (0.0023 sees about 700 m). */
  readonly fogDensity: number;
  /** Sunlight (or moonlight) and light from the sky, as shares of a clear day's. */
  readonly sunlight: Fraction;
  readonly skylight: Fraction;
  /** Tints both lights (white: unchanged). */
  readonly lightColor: number;
  /** How much of the sky the clouds cover, and how bright they are. */
  readonly cloudCover: Fraction;
  readonly cloudBrightness: Fraction;
  /** How hard it rains (0: dry). */
  readonly rain: Fraction;
  /** Headlights and lit lamps (0: day). */
  readonly lamps: Fraction;
}

export function validateWeatherDefinition(weather: WeatherDefinition, path: string, validator: Validator): void {
  validator.id(weather.id, `${path}.id`);
  validator.positiveNumber(weather.weight, `${path}.weight`);
  validator.positiveNumber(weather.minSeconds, `${path}.minSeconds`);
  validator.check(
    Number.isFinite(weather.maxSeconds) && weather.maxSeconds >= weather.minSeconds,
    `${path}.maxSeconds`,
    'must be at least minSeconds',
  );
  validator.check(
    Number.isFinite(weather.gripFactor) && weather.gripFactor >= 0.5 && weather.gripFactor <= 1,
    `${path}.gripFactor`,
    'must be from 0.5 to 1',
  );
  validator.check(
    Number.isFinite(weather.trafficSpeedFactor) && weather.trafficSpeedFactor >= 0.5 && weather.trafficSpeedFactor <= 1,
    `${path}.trafficSpeedFactor`,
    'must be from 0.5 to 1',
  );
  const look = weather.look;
  if (!validator.check(typeof look === 'object' && look !== null, `${path}.look`, 'must be an object')) {
    return;
  }
  for (const key of ['zenithColor', 'horizonColor', 'lightColor'] as const) {
    validator.check(
      Number.isInteger(look[key]) && look[key] >= 0 && look[key] <= 0xffffff,
      `${path}.look.${key}`,
      'must be a 0xRRGGBB colour',
    );
  }
  validator.check(
    Number.isFinite(look.fogDensity) && look.fogDensity > 0 && look.fogDensity <= 0.02,
    `${path}.look.fogDensity`,
    'must be greater than 0 and at most 0.02',
  );
  for (const key of ['sunlight', 'skylight', 'cloudCover', 'cloudBrightness', 'rain', 'lamps'] as const) {
    validator.fraction(look[key], `${path}.look.${key}`);
  }
}
