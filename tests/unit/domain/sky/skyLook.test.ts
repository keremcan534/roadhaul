import { describe, expect, it } from 'vitest';
import { DAYLIGHT } from '../../../../src/data/content/daylight';
import { WEATHER } from '../../../../src/data/content/weather';
import type { WeatherLook } from '../../../../src/data/definitions/WeatherDefinition';
import {
  composeSky,
  createSkyLook,
  daylightWeights,
  mixWeather,
  type DaylightWeights,
  type SkyLook,
} from '../../../../src/domain/sky/skyLook';

const weather = (id: string): WeatherLook => WEATHER.find((candidate) => candidate.id === id)!.look;
const daylight = (id: string): WeatherLook => DAYLIGHT.find((candidate) => candidate.id === id)!.look;
const weights = (elevation: number): DaylightWeights => daylightWeights(elevation, 12, 3, -12, { day: 0, twilight: 0, night: 0 });

/** The sky at `weights` in `weatherId`, the sun up by `sunUp`, the moon lit by `moonlit`. */
function sky(at: DaylightWeights, weatherId: string, sunUp: number, moonlit = 1): SkyLook {
  const now = mixWeather(weather(weatherId), weather(weatherId), 1, createSkyLook());
  return composeSky(weather('clear'), daylight('dusk'), daylight('night'), at, sunUp, moonlit, now, createSkyLook());
}

/** 0xRRGGBB channels. */
const channels = (color: number): number[] => [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];

describe('skyLook', () => {
  it('weighs the day, the twilight and the night by the sun\'s elevation, adding up to one', () => {
    expect(weights(40)).toEqual({ day: 1, twilight: 0, night: 0 });
    expect(weights(3)).toEqual({ day: 0, twilight: 1, night: 0 });
    expect(weights(-30)).toEqual({ day: 0, twilight: 0, night: 1 });
    let previousNight = 0;
    for (let elevation = 20; elevation >= -20; elevation -= 0.5) {
      const { day, twilight, night } = weights(elevation);
      expect(day + twilight + night).toBeCloseTo(1, 12);
      expect(night).toBeGreaterThanOrEqual(previousNight);
      previousNight = night;
    }
  });

  it('mixes two weathers by the way from one to the other', () => {
    const halfway = mixWeather(weather('clear'), weather('rain'), 0.5, createSkyLook());
    expect(halfway.fogDensity).toBeCloseTo((weather('clear').fogDensity + weather('rain').fogDensity) / 2, 12);
    const [r, g, b] = channels(halfway.zenithColor);
    const [cr, cg, cb] = channels(weather('clear').zenithColor);
    const [rr, rg, rb] = channels(weather('rain').zenithColor);
    expect(Math.abs(r! - (cr! + rr!) / 2)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(g! - (cg! + rg!) / 2)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(b! - (cb! + rb!) / 2)).toBeLessThanOrEqual(0.5);
  });

  it('is the weather\'s own look by day, and the time\'s own look under a clear sky', () => {
    for (const id of ['clear', 'cloudy', 'rain']) {
      const day = sky(weights(40), id, 1);
      expect(day.zenithColor, id).toBe(weather(id).zenithColor);
      expect(day.horizonColor, id).toBe(weather(id).horizonColor);
      expect(day.sunlight, id).toBeCloseTo(weather(id).sunlight, 12);
      expect(day.skylight, id).toBeCloseTo(weather(id).skylight, 12);
      expect(day.lamps, id).toBe(weather(id).lamps);
      expect(day.rain, id).toBe(weather(id).rain);
      expect(day.moonlight, id).toBe(0);
    }
    const dusk = sky(weights(3), 'clear', 1);
    expect(dusk.horizonColor).toBe(daylight('dusk').horizonColor);
    expect(dusk.warmth).toBeCloseTo(daylight('dusk').warmth, 12);
    expect(dusk.lamps).toBe(daylight('dusk').lamps);
  });

  it('lights a clear night by the moon, dimmer without it, and turns the lamps and the stars on', () => {
    const night = sky(weights(-30), 'clear', 0, 1);
    expect(night.sunlight).toBe(0);
    expect(night.moonlight).toBeCloseTo(daylight('night').sunlight, 12);
    expect(night.lamps).toBe(1);
    expect(night.stars).toBe(1);
    expect(night.moon).toBe(1);
    const moonless = sky(weights(-30), 'clear', 0, 0);
    expect(moonless.moonlight).toBeCloseTo(daylight('night').sunlight * 0.25, 12);
  });

  it('makes a rainy night a night, only darker, greyer and wet, with neither stars nor moon', () => {
    const clear = sky(weights(-30), 'clear', 0);
    const rain = sky(weights(-30), 'rain', 0);
    expect(rain.rain).toBe(1);
    expect(rain.lamps).toBe(1);
    expect(rain.stars).toBe(0);
    expect(rain.moon).toBe(0);
    expect(rain.cloudCover).toBe(1);
    expect(rain.skylight).toBeLessThan(clear.skylight);
    expect(rain.moonlight).toBeLessThan(clear.moonlight);
    expect(rain.fogDensity).toBeGreaterThan(clear.fogDensity);
    expect(rain.saturation).toBeLessThan(clear.saturation);
    const brightness = (color: number): number => channels(color).reduce((sum, value) => sum + value, 0);
    expect(brightness(rain.zenithColor)).toBeLessThanOrEqual(brightness(clear.zenithColor) + 3);
  });

  it('takes the sun\'s light away as it sets, whatever the time\'s look', () => {
    const setting = sky(weights(0), 'clear', 0.2);
    const set = sky(weights(0), 'clear', 0);
    expect(set.sunlight).toBe(0);
    expect(setting.sunlight).toBeGreaterThan(0);
    expect(set.skylight).toBe(setting.skylight);
  });
});
