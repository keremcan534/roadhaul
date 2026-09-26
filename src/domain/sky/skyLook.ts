import { clamp, clamp01, smoothstep } from '../../core/math/scalar';
import type { WeatherLook } from '../../data/definitions/WeatherDefinition';

/**
 * How the sky, the light and the picture look now: the time of day's look
 * (a clear sky's) with the weather's laid over it. The same numbers as a
 * WeatherLook, writable so per-frame code reuses one, and the night's key
 * light (`moonlight`, the moon's or the stars') apart from the sun's.
 */
export type SkyLook = { -readonly [K in keyof WeatherLook]: WeatherLook[K] } & { moonlight: number };

/** A look to write into: a clear day's, until something is. */
export function createSkyLook(): SkyLook {
  return {
    zenithColor: 0x3f7fc7,
    horizonColor: 0xc4dcef,
    fogDensity: 0.0023,
    sunlight: 1,
    skylight: 1,
    lightColor: 0xffffff,
    cloudCover: 0.5,
    cloudBrightness: 1,
    rain: 0,
    lamps: 0,
    stars: 0,
    moon: 0,
    saturation: 1,
    contrast: 1,
    warmth: 0,
    bloom: 0.2,
    moonlight: 0,
  };
}

/** How much of the day's, the twilight's (dawn's or dusk's) and the night's look the sky takes: they add up to 1. */
export interface DaylightWeights {
  day: number;
  twilight: number;
  night: number;
}

/**
 * The time of day's share of each look at a sun elevation (degrees): the
 * day's from `dayFrom` up, the twilight's exactly at `twilightAt`, the
 * night's from `nightAt` down, eased in between. Writes and returns `out`.
 */
export function daylightWeights(
  elevationDegrees: number,
  dayFrom: number,
  twilightAt: number,
  nightAt: number,
  out: DaylightWeights,
): DaylightWeights {
  if (elevationDegrees >= twilightAt) {
    const toDay = smoothstep(twilightAt, dayFrom, elevationDegrees);
    out.day = toDay;
    out.twilight = 1 - toDay;
    out.night = 0;
  } else {
    const toNight = 1 - smoothstep(nightAt, twilightAt, elevationDegrees);
    out.day = 0;
    out.twilight = 1 - toNight;
    out.night = toNight;
  }
  return out;
}

/**
 * The weather's look `blend` (0..1) of the way from `from` to `to` (a
 * change under way), into `out`. Allocation-free.
 */
export function mixWeather(from: WeatherLook, to: WeatherLook, blend: number, out: SkyLook): SkyLook {
  const t = clamp01(blend);
  out.zenithColor = mixColor(from.zenithColor, to.zenithColor, t);
  out.horizonColor = mixColor(from.horizonColor, to.horizonColor, t);
  out.lightColor = mixColor(from.lightColor, to.lightColor, t);
  out.fogDensity = mix(from.fogDensity, to.fogDensity, t);
  out.sunlight = mix(from.sunlight, to.sunlight, t);
  out.skylight = mix(from.skylight, to.skylight, t);
  out.cloudCover = mix(from.cloudCover, to.cloudCover, t);
  out.cloudBrightness = mix(from.cloudBrightness, to.cloudBrightness, t);
  out.rain = mix(from.rain, to.rain, t);
  out.lamps = mix(from.lamps, to.lamps, t);
  out.stars = mix(from.stars, to.stars, t);
  out.moon = mix(from.moon, to.moon, t);
  out.saturation = mix(from.saturation, to.saturation, t);
  out.contrast = mix(from.contrast, to.contrast, t);
  out.warmth = mix(from.warmth, to.warmth, t);
  out.bloom = mix(from.bloom, to.bloom, t);
  out.moonlight = 0;
  return out;
}

/**
 * The sky at a time of day with the weather over it (spec §38–39), into
 * `out`. Allocation-free.
 * - `clearDay` is the clear weather's look, a clear day's; `twilight` dawn's
 *   (the sun rising) or dusk's; `night` the night's; `weights` how much of
 *   each the time takes (daylightWeights).
 * - `sunUp` is how much of the sun stands above the horizon (0..1): its
 *   light goes as it sets, the sky's glow stays a while. `moonlit`, how
 *   bright the moon is (its phase, and whether it is up): a moonless night
 *   keeps a quarter of a full moon's light, from the stars and the towns.
 * - `weather` is the weather's look now (mixWeather). Whatever it changes of
 *   a clear day's look it changes of the time's the same way: a rainy night
 *   is a night, only darker, greyer, hazier, wet, its lamps as lit as
 *   ever; under an overcast sky neither the stars nor the moon show.
 */
export function composeSky(
  clearDay: WeatherLook,
  twilight: WeatherLook,
  night: WeatherLook,
  weights: Readonly<DaylightWeights>,
  sunUp: number,
  moonlit: number,
  weather: Readonly<SkyLook>,
  out: SkyLook,
): SkyLook {
  const { day: d, twilight: w, night: n } = weights;
  const sunRatio = weather.sunlight / Math.max(clearDay.sunlight, 1e-3);
  const overcast = clamp01((weather.cloudCover - clearDay.cloudCover) / Math.max(1 - clearDay.cloudCover, 1e-3));

  out.zenithColor = filterColor(
    weighColors(clearDay.zenithColor, d, twilight.zenithColor, w, night.zenithColor, n),
    weather.zenithColor,
    clearDay.zenithColor,
  );
  out.horizonColor = filterColor(
    weighColors(clearDay.horizonColor, d, twilight.horizonColor, w, night.horizonColor, n),
    weather.horizonColor,
    clearDay.horizonColor,
  );
  out.lightColor = filterColor(
    weighColors(clearDay.lightColor, d, twilight.lightColor, w, night.lightColor, n),
    weather.lightColor,
    clearDay.lightColor,
  );
  const fog = weigh(clearDay.fogDensity, d, twilight.fogDensity, w, night.fogDensity, n);
  out.fogDensity = clamp(fog + weather.fogDensity - clearDay.fogDensity, 0.0005, 0.02);
  // The sun's light while it is up: the day's, or the twilight's low sun.
  const sunTime = d + w > 1e-6 ? (clearDay.sunlight * d + twilight.sunlight * w) / (d + w) : 0;
  out.sunlight = clamp01(sunTime * clamp01(sunUp) * sunRatio);
  out.moonlight = clamp01(night.sunlight * (1 - clamp01(sunUp)) * (0.25 + 0.75 * clamp01(moonlit)) * sunRatio);
  const skylight = weigh(clearDay.skylight, d, twilight.skylight, w, night.skylight, n);
  out.skylight = clamp01((skylight * weather.skylight) / Math.max(clearDay.skylight, 1e-3));
  const cover = weigh(clearDay.cloudCover, d, twilight.cloudCover, w, night.cloudCover, n);
  out.cloudCover = clamp01(cover + (1 - cover) * overcast);
  const cloudBrightness = weigh(clearDay.cloudBrightness, d, twilight.cloudBrightness, w, night.cloudBrightness, n);
  out.cloudBrightness = clamp01((cloudBrightness * weather.cloudBrightness) / Math.max(clearDay.cloudBrightness, 1e-3));
  out.rain = weather.rain;
  out.lamps = Math.max(weigh(clearDay.lamps, d, twilight.lamps, w, night.lamps, n), weather.lamps);
  out.stars = clamp01(weigh(clearDay.stars, d, twilight.stars, w, night.stars, n) * (1 - overcast) * (1 - overcast));
  out.moon = clamp01(weigh(clearDay.moon, d, twilight.moon, w, night.moon, n) * (1 - overcast));
  const saturation = weigh(clearDay.saturation, d, twilight.saturation, w, night.saturation, n);
  out.saturation = clamp(saturation + weather.saturation - clearDay.saturation, 0.5, 1.5);
  const contrast = weigh(clearDay.contrast, d, twilight.contrast, w, night.contrast, n);
  out.contrast = clamp(contrast + weather.contrast - clearDay.contrast, 0.7, 1.3);
  const warmth = weigh(clearDay.warmth, d, twilight.warmth, w, night.warmth, n);
  out.warmth = clamp(warmth + weather.warmth - clearDay.warmth, -1, 1);
  out.bloom = clamp01(weigh(clearDay.bloom, d, twilight.bloom, w, night.bloom, n) + weather.bloom - clearDay.bloom);
  return out;
}

function mix(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Three values weighed (the weights add up to 1). */
function weigh(a: number, wa: number, b: number, wb: number, c: number, wc: number): number {
  return a * wa + b * wb + c * wc;
}

/** Two 0xRRGGBB colours mixed channel by channel. */
function mixColor(from: number, to: number, t: number): number {
  return pack(
    mix((from >> 16) & 0xff, (to >> 16) & 0xff, t),
    mix((from >> 8) & 0xff, (to >> 8) & 0xff, t),
    mix(from & 0xff, to & 0xff, t),
  );
}

/** Three 0xRRGGBB colours weighed channel by channel (the weights add up to 1). */
function weighColors(a: number, wa: number, b: number, wb: number, c: number, wc: number): number {
  return pack(
    weigh((a >> 16) & 0xff, wa, (b >> 16) & 0xff, wb, (c >> 16) & 0xff, wc),
    weigh((a >> 8) & 0xff, wa, (b >> 8) & 0xff, wb, (c >> 8) & 0xff, wc),
    weigh(a & 0xff, wa, b & 0xff, wb, c & 0xff, wc),
  );
}

/**
 * `color` changed as the weather changes a clear day's: each channel times
 * the weather's over the clear day's (within 0.2 to 3, so a black channel
 * cannot blow up).
 */
function filterColor(color: number, weather: number, clearDay: number): number {
  return pack(
    filterChannel(color, weather, clearDay, 16),
    filterChannel(color, weather, clearDay, 8),
    filterChannel(color, weather, clearDay, 0),
  );
}

function filterChannel(color: number, weather: number, clearDay: number, shift: number): number {
  const ratio = clamp(((weather >> shift) & 0xff) / Math.max((clearDay >> shift) & 0xff, 1), 0.2, 3);
  return ((color >> shift) & 0xff) * ratio;
}

function pack(r: number, g: number, b: number): number {
  return (toByte(r) << 16) | (toByte(g) << 8) | toByte(b);
}

function toByte(value: number): number {
  return clamp(Math.round(value), 0, 255);
}
