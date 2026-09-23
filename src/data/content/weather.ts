import type { WeatherDefinition } from '../definitions/WeatherDefinition';

/**
 * The region's weather (spec §38). Clear days are the most common; rain and
 * night come now and then and ask more of the driver: the road is slippery
 * in the rain, and at night the headlights only reach so far.
 */
export const WEATHER: readonly WeatherDefinition[] = [
  {
    id: 'clear',
    weight: 5,
    minSeconds: 240,
    maxSeconds: 420,
    gripFactor: 1,
    trafficSpeedFactor: 1,
    look: {
      zenithColor: 0x3f7fc7,
      horizonColor: 0xc4dcef,
      fogDensity: 0.0023,
      sunlight: 1,
      skylight: 1,
      lightColor: 0xffffff,
      cloudCover: 0.55,
      cloudBrightness: 1,
      rain: 0,
      lamps: 0,
    },
  },
  {
    id: 'cloudy',
    weight: 3,
    minSeconds: 180,
    maxSeconds: 360,
    gripFactor: 1,
    trafficSpeedFactor: 1,
    look: {
      zenithColor: 0x6d7f93,
      horizonColor: 0xb4bec8,
      fogDensity: 0.003,
      sunlight: 0.3,
      skylight: 0.85,
      lightColor: 0xeef2f7,
      cloudCover: 1,
      cloudBrightness: 0.72,
      rain: 0,
      lamps: 0,
    },
  },
  {
    id: 'rain',
    weight: 2,
    minSeconds: 150,
    maxSeconds: 300,
    gripFactor: 0.78,
    trafficSpeedFactor: 0.85,
    look: {
      zenithColor: 0x46525f,
      horizonColor: 0x7f8b97,
      fogDensity: 0.0048,
      sunlight: 0.1,
      skylight: 0.6,
      lightColor: 0xdfe6ee,
      cloudCover: 1,
      cloudBrightness: 0.5,
      rain: 1,
      lamps: 0.35,
    },
  },
  {
    id: 'night',
    weight: 2,
    minSeconds: 180,
    maxSeconds: 300,
    gripFactor: 1,
    trafficSpeedFactor: 0.9,
    look: {
      zenithColor: 0x070d1c,
      horizonColor: 0x1b2740,
      fogDensity: 0.0032,
      sunlight: 0.1,
      skylight: 0.3,
      lightColor: 0x9fb4e0,
      cloudCover: 0.35,
      cloudBrightness: 0.12,
      rain: 0,
      lamps: 1,
    },
  },
];
