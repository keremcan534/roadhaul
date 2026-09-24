import type { Validator } from '../../core/validation/Validator';
import type { Fraction } from '../units';

/**
 * A kind of weather (spec §38: clear, cloudy, rain, night), or a time of day
 * (spec §39: morning, day, evening, night). It changes how the truck grips
 * and how fast traffic drives, and how the world looks. Colours are
 * 0xRRGGBB; light levels are shares of a clear day's.
 */
export interface WeatherDefinition {
  /** Stable snake_case id. */
  readonly id: string;
  /** How likely the weather turns to this next, relative to the others. */
  readonly weight: number;
  /**
   * The weathers this one may turn into, by id (their weights decide which):
   * how the day goes round, dusk to night to dawn. Any other when absent.
   */
  readonly next?: readonly string[];
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
  /** How high the sun (or the moon) stands: 1 as high as on a clear day, 0 on the horizon. */
  readonly sunHeight: Fraction;
  /** How brightly the stars shine (0: not at all; 1: a clear night). */
  readonly stars: Fraction;
  /** How brightly the moon shows where the light comes from, in the sun's place (0: not at all; 1: full). */
  readonly moon: Fraction;
}

export function validateWeatherDefinition(weather: WeatherDefinition, path: string, validator: Validator): void {
  validator.id(weather.id, `${path}.id`);
  validator.positiveNumber(weather.weight, `${path}.weight`);
  if (weather.next !== undefined) {
    const next = weather.next;
    if (validator.check(Array.isArray(next) && next.length > 0, `${path}.next`, 'must list at least one weather')) {
      next.forEach((id, index) => {
        if (validator.id(id, `${path}.next[${index}]`)) {
          validator.check(id !== weather.id, `${path}.next[${index}]`, 'must be another weather');
          validator.check(next.indexOf(id) === index, `${path}.next[${index}]`, `"${id}" is listed twice`);
        }
      });
    }
  }
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
  const fractions = ['sunlight', 'skylight', 'cloudCover', 'cloudBrightness', 'rain', 'lamps', 'sunHeight', 'stars', 'moon'] as const;
  for (const key of fractions) {
    validator.fraction(look[key], `${path}.look.${key}`);
  }
}
