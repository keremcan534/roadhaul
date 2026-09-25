import type { DaylightDefinition } from '../definitions/DaylightDefinition';

/**
 * How the region looks at the times of day with a look of their own (spec
 * §39), under a clear sky; the weather lays its own over them. The sky goes
 * from the day's to dawn's or dusk's as the sun comes near the horizon: a
 * pale, rosy morning with a little haze, a warm evening with the lamps
 * coming on. Past sunset it darkens on to the night's, whose light is the
 * moon's (as bright as its phase lets it) and the stars'.
 */
export const DAYLIGHT: readonly DaylightDefinition[] = [
  {
    // Morning: the sun just up.
    id: 'dawn',
    sunElevationDegrees: 4,
    trafficSpeedFactor: 0.95,
    look: {
      zenithColor: 0x5a7bb3,
      horizonColor: 0xf3c4a6,
      fogDensity: 0.0034,
      sunlight: 0.7,
      skylight: 0.72,
      lightColor: 0xffcfae,
      cloudCover: 0.4,
      cloudBrightness: 0.9,
      rain: 0,
      lamps: 0.25,
      stars: 0.1,
      moon: 0,
      saturation: 1.08,
      contrast: 1.03,
      warmth: 0.28,
      bloom: 0.5,
    },
  },
  {
    // Evening: the sun low in the sky, warm light, and the lamps coming on.
    id: 'dusk',
    sunElevationDegrees: 3,
    trafficSpeedFactor: 1,
    look: {
      zenithColor: 0x33467e,
      horizonColor: 0xf09a62,
      fogDensity: 0.0027,
      sunlight: 0.75,
      skylight: 0.8,
      lightColor: 0xffbf8a,
      cloudCover: 0.5,
      cloudBrightness: 0.85,
      rain: 0,
      lamps: 0.6,
      stars: 0.15,
      moon: 0,
      saturation: 1.14,
      contrast: 1.05,
      warmth: 0.45,
      bloom: 0.6,
    },
  },
  {
    // Night: from about the end of the evening's twilight.
    id: 'night',
    sunElevationDegrees: -12,
    trafficSpeedFactor: 0.9,
    look: {
      zenithColor: 0x070d1c,
      horizonColor: 0x1b2740,
      fogDensity: 0.0032,
      sunlight: 0.1,
      skylight: 0.34,
      lightColor: 0x9fb4e0,
      cloudCover: 0.35,
      cloudBrightness: 0.12,
      rain: 0,
      lamps: 1,
      stars: 1,
      moon: 1,
      saturation: 0.86,
      contrast: 1.08,
      warmth: -0.32,
      bloom: 0.9,
    },
  },
];
