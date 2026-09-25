import { describe, expect, it } from 'vitest';
import { Validator } from '../../../../src/core/validation/Validator';
import { WEATHER } from '../../../../src/data/content/weather';
import { validateWeatherDefinition, type WeatherDefinition } from '../../../../src/data/definitions/WeatherDefinition';
import { weatherFixture } from '../../../support/contentFixtures';

function issues(weather: WeatherDefinition): string[] {
  const validator = new Validator();
  validateWeatherDefinition(weather, 'weather', validator);
  return validator.issues.map((issue) => issue.path);
}

describe('validateWeatherDefinition', () => {
  it('accepts the built-in weather and the test fixture', () => {
    for (const weather of [...WEATHER, weatherFixture()]) {
      expect(issues(weather), weather.id).toEqual([]);
    }
  });

  it('ships the kinds of spec §38, with clear days the most common and rain the hardest on the driver', () => {
    expect(WEATHER.map((weather) => weather.id)).toEqual(['clear', 'cloudy', 'rain']);
    const byId = (id: string) => WEATHER.find((weather) => weather.id === id)!;
    for (const weather of WEATHER) {
      expect(weather.weight).toBeLessThanOrEqual(byId('clear').weight);
      // The weather turns only into another weather: the time of day is apart from it.
      for (const next of weather.next ?? []) {
        expect(WEATHER.map((candidate) => candidate.id)).toContain(next);
      }
      // By day: no stars and no moon (the time of day's looks bring them).
      expect(weather.look.stars).toBe(0);
      expect(weather.look.moon).toBe(0);
    }
    // Rain makes the road slippery, slows traffic, and turns the lamps on under its dark clouds.
    const rain = byId('rain');
    expect(rain.gripFactor).toBeLessThan(1);
    expect(rain.trafficSpeedFactor).toBeLessThan(1);
    expect(rain.look.rain).toBe(1);
    expect(rain.look.lamps).toBeGreaterThan(0);
    expect(rain.look.saturation).toBeLessThan(byId('clear').look.saturation);
    expect(byId('clear').look.lamps).toBe(0);
  });

  it('reports successions that are not a list of other weathers', () => {
    expect(issues(weatherFixture({ next: [] }))).toEqual(['weather.next']);
    expect(issues(weatherFixture({ next: ['test_clear', 'Rain', 'cloudy', 'cloudy'] }))).toEqual([
      'weather.next[0]',
      'weather.next[1]',
      'weather.next[3]',
    ]);
  });

  it('reports times, effects and looks out of range', () => {
    const fixture = weatherFixture();
    const weather = weatherFixture({
      id: 'Stormy Weather',
      weight: 0,
      minSeconds: 100,
      maxSeconds: 50,
      gripFactor: 0.2,
      trafficSpeedFactor: 1.5,
      look: {
        ...fixture.look,
        zenithColor: -1,
        fogDensity: 0,
        rain: 2,
        lamps: Number.NaN,
        stars: -0.1,
        moon: 2,
        bloom: 1.2,
        saturation: 2,
        contrast: 0.5,
        warmth: Number.NaN,
      },
    });

    expect(issues(weather)).toEqual([
      'weather.id',
      'weather.weight',
      'weather.maxSeconds',
      'weather.gripFactor',
      'weather.trafficSpeedFactor',
      'weather.look.zenithColor',
      'weather.look.fogDensity',
      'weather.look.rain',
      'weather.look.lamps',
      'weather.look.stars',
      'weather.look.moon',
      'weather.look.bloom',
      'weather.look.saturation',
      'weather.look.contrast',
      'weather.look.warmth',
    ]);
    expect(issues({ ...fixture, look: null as unknown as WeatherDefinition['look'] })).toEqual(['weather.look']);
  });
});
