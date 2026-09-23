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

  it('ships the four kinds of spec §38, with clear days the most common', () => {
    expect(WEATHER.map((weather) => weather.id)).toEqual(['clear', 'cloudy', 'rain', 'night']);
    const clear = WEATHER.find((weather) => weather.id === 'clear')!;
    for (const weather of WEATHER) {
      expect(weather.weight).toBeLessThanOrEqual(clear.weight);
    }
    // Rain makes the road slippery and slows traffic; night turns the lamps on.
    const rain = WEATHER.find((weather) => weather.id === 'rain')!;
    const night = WEATHER.find((weather) => weather.id === 'night')!;
    expect(rain.gripFactor).toBeLessThan(1);
    expect(rain.trafficSpeedFactor).toBeLessThan(1);
    expect(rain.look.rain).toBe(1);
    expect(night.look.lamps).toBe(1);
    // Dark, but the road still shows beyond the headlights.
    expect(night.look.sunlight + night.look.skylight).toBeLessThan(0.5);
    expect(night.look.skylight).toBeGreaterThan(0.2);
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
      look: { ...fixture.look, zenithColor: -1, fogDensity: 0, rain: 2, lamps: Number.NaN },
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
    ]);
    expect(issues({ ...fixture, look: null as unknown as WeatherDefinition['look'] })).toEqual(['weather.look']);
  });
});
